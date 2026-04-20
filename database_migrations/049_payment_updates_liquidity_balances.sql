-- При запис на плащане от Задължения с начин „в брой“ / „банков превод“
-- да се увеличава съответно cash_opening_balance или bank_account_balance в app_settings (id=1).
-- При изтриване на плащане с възстановяване — обратното.
-- Изисква: 015, 017, 048.

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
  v_m TEXT;
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

  v_m := lower(btrim(COALESCE(p_payment_method, '')));
  IF v_m = 'cash' THEN
    UPDATE public.app_settings
    SET cash_opening_balance = cash_opening_balance + p_amount,
        updated_at = NOW()
    WHERE id = 1;
  ELSIF v_m = 'bank_transfer' THEN
    UPDATE public.app_settings
    SET bank_account_balance = COALESCE(bank_account_balance, 0::NUMERIC) + p_amount,
        updated_at = NOW()
    WHERE id = 1;
  END IF;

  RETURN v_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_payment_with_restore(p_payment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amt NUMERIC;
  v_m TEXT;
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да изтривате плащания';
  END IF;

  SELECT amount, payment_method::TEXT INTO v_amt, v_m
  FROM public.payments
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.unit_obligations uo
  SET amount_remaining = uo.amount_remaining + pa.amount
  FROM public.payment_allocations pa
  WHERE pa.unit_obligation_id = uo.id
    AND pa.payment_id = p_payment_id;

  v_m := lower(btrim(COALESCE(v_m, '')));
  IF v_m = 'cash' AND v_amt IS NOT NULL THEN
    UPDATE public.app_settings
    SET cash_opening_balance = cash_opening_balance - v_amt,
        updated_at = NOW()
    WHERE id = 1;
  ELSIF v_m = 'bank_transfer' AND v_amt IS NOT NULL THEN
    UPDATE public.app_settings
    SET bank_account_balance = COALESCE(bank_account_balance, 0::NUMERIC) - v_amt,
        updated_at = NOW()
    WHERE id = 1;
  END IF;

  DELETE FROM public.payments WHERE id = p_payment_id;
END;
$$;

COMMENT ON FUNCTION public.register_payment(UUID, NUMERIC, DATE, TEXT, TEXT) IS
  'Регистрира плащане по обект; при payment_method cash/bank_transfer коригира наличностите в app_settings.';

COMMENT ON FUNCTION public.delete_payment_with_restore(UUID) IS
  'Изтрива плащане и възстановява задължения; при cash/bank_transfer намалява съответната наличност.';
