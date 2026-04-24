-- Премахва наличностите от app_settings; балансът се извежда от приходи + плащания − разходи (клиент + тази логика).
-- Премахва тригери към app_settings; register_payment/delete_payment вече не пипат настройките.
-- Изпълни в Supabase SQL Editor след предишните миграции.

-- ========== Тригери: вече не обновяват app_settings ==========
DROP TRIGGER IF EXISTS trg_expenses_apply_liquidity ON public.expenses;
DROP FUNCTION IF EXISTS public.trg_expenses_apply_liquidity();

DROP TRIGGER IF EXISTS trg_income_apply_liquidity ON public.income;
DROP FUNCTION IF EXISTS public.trg_income_apply_liquidity();

-- ========== register_payment: без UPDATE app_settings ==========
CREATE OR REPLACE FUNCTION public.register_payment(
  p_unit_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да записвате плащания';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Невалидна сума';
  END IF;

  INSERT INTO public.payments (income_id, unit_id, amount, payment_date, status, notes, payment_method)
  VALUES (
    NULL,
    p_unit_id,
    p_amount,
    p_payment_date,
    'paid',
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    NULLIF(btrim(COALESCE(p_payment_method, '')), '')
  )
  RETURNING id INTO v_payment_id;

  PERFORM public.apply_payment_allocations(v_payment_id, p_unit_id, p_amount);

  RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION public.register_payment(UUID, NUMERIC, DATE, TEXT, TEXT) IS
  'Регистрира плащане по обект; наличността се изчислява от плащания/приходи/разходи в приложението.';

-- ========== delete_payment_with_restore: без app_settings ==========
CREATE OR REPLACE FUNCTION public.delete_payment_with_restore(p_payment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да изтривате плащания';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
    RETURN;
  END IF;

  UPDATE public.unit_obligations uo
  SET amount_remaining = uo.amount_remaining + pa.amount
  FROM public.payment_allocations pa
  WHERE pa.unit_obligation_id = uo.id
    AND pa.payment_id = p_payment_id;

  DELETE FROM public.payments WHERE id = p_payment_id;
END;
$$;

COMMENT ON FUNCTION public.delete_payment_with_restore(UUID) IS
  'Изтрива плащане и възстановява задължения.';

-- ========== Премахване на колоните (балансът не се пази тук) ==========
ALTER TABLE public.app_settings
  DROP COLUMN IF EXISTS cash_opening_balance,
  DROP COLUMN IF EXISTS bank_account_balance;

COMMENT ON TABLE public.app_settings IS
  'Глобални настройки (един ред id=1); наличностите не се пазят тук — от приходи/плащания/разходи.';
