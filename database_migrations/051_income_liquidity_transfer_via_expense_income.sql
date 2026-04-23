-- Приходи: накъде влиза сумата (каса/сметка) + движение на наличност за нови записи
-- Прехвърляне каса↔сметка: един RPC създава ред в expenses + ред в income (без стария transfer_liquidity)
-- Изисква: 050 (expenses liquidity), is_editor_or_admin (015), 048 bank balance

-- ========== income: колона за целеви източник + проследяване ==========
ALTER TABLE public.income
  ADD COLUMN IF NOT EXISTS received_to TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE public.income
  DROP CONSTRAINT IF EXISTS income_received_to_chk;

ALTER TABLE public.income
  ADD CONSTRAINT income_received_to_chk
  CHECK (received_to IN ('cash', 'bank_transfer'));

COMMENT ON COLUMN public.income.received_to IS
  'Накъде е приет приходът: каса или банкова сметка; увеличава съответната наличност.';

ALTER TABLE public.income
  ADD COLUMN IF NOT EXISTS liquidity_tracked BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.income.liquidity_tracked IS
  'false = стари редове без корекция на наличност; true = нови записи.';

UPDATE public.income SET liquidity_tracked = false;

-- ========== Тригер: приходи → увеличаване на наличност ==========
CREATE OR REPLACE FUNCTION public.trg_income_apply_liquidity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash_delta NUMERIC(20, 2) := 0;
  v_bank_delta NUMERIC(20, 2) := 0;
  r RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    r := NEW;
    IF NOT COALESCE(r.liquidity_tracked, false) THEN
      RETURN NEW;
    END IF;
    IF r.received_to = 'cash' THEN
      v_cash_delta := r.amount;
    ELSE
      v_bank_delta := r.amount;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    r := OLD;
    IF NOT COALESCE(r.liquidity_tracked, false) THEN
      RETURN OLD;
    END IF;
    IF r.received_to = 'cash' THEN
      v_cash_delta := -r.amount;
    ELSE
      v_bank_delta := -r.amount;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.liquidity_tracked, false) THEN
      IF OLD.received_to = 'cash' THEN
        v_cash_delta := v_cash_delta - OLD.amount;
      ELSE
        v_bank_delta := v_bank_delta - OLD.amount;
      END IF;
    END IF;
    IF COALESCE(NEW.liquidity_tracked, false) THEN
      IF NEW.received_to = 'cash' THEN
        v_cash_delta := v_cash_delta + NEW.amount;
      ELSE
        v_bank_delta := v_bank_delta + NEW.amount;
      END IF;
    END IF;
  END IF;

  IF v_cash_delta <> 0 OR v_bank_delta <> 0 THEN
    UPDATE public.app_settings
    SET
      cash_opening_balance = cash_opening_balance + v_cash_delta,
      bank_account_balance = COALESCE(bank_account_balance, 0::NUMERIC(20, 2)) + v_bank_delta,
      updated_at = NOW()
    WHERE id = 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_income_apply_liquidity ON public.income;
CREATE TRIGGER trg_income_apply_liquidity
  AFTER INSERT OR UPDATE OR DELETE ON public.income
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_income_apply_liquidity();

-- ========== Атомарно: разход (от източник) + приход (към цел) ==========
CREATE OR REPLACE FUNCTION public.record_liquidity_transfer(
  p_amount NUMERIC(20, 2),
  p_date DATE,
  p_from TEXT,
  p_to TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desc_exp TEXT;
  v_desc_inc TEXT;
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Невалидна сума';
  END IF;
  IF p_from NOT IN ('cash', 'bank_transfer') OR p_to NOT IN ('cash', 'bank_transfer') OR p_from = p_to THEN
    RAISE EXCEPTION 'Невалидна посока';
  END IF;

  v_desc_exp := format(
    'Прехвърляне наличност (1/2): намаляване от %s — %s €',
    CASE p_from WHEN 'cash' THEN 'каса' ELSE 'сметка' END,
    p_amount
  );
  v_desc_inc := format(
    'Прехвърляне наличност (2/2): внасяне в %s — %s €',
    CASE p_to WHEN 'cash' THEN 'каса' ELSE 'сметка' END,
    p_amount
  );

  INSERT INTO public.expenses (
    amount,
    description,
    date,
    category,
    distribution_method,
    paid_from,
    liquidity_tracked
  ) VALUES (
    p_amount,
    v_desc_exp,
    p_date,
    'Вътрешно прехвърляне',
    'equal',
    p_from,
    true
  );

  INSERT INTO public.income (
    type,
    amount,
    description,
    date,
    unit_id,
    received_to,
    liquidity_tracked
  ) VALUES (
    'other',
    p_amount,
    v_desc_inc,
    p_date,
    NULL,
    p_to,
    true
  );
END;
$$;

COMMENT ON FUNCTION public.record_liquidity_transfer(NUMERIC, DATE, TEXT, TEXT) IS
  'Създава ред в expenses (намалява p_from) и ред в income (увеличава p_to); атомарно.';

REVOKE ALL ON FUNCTION public.record_liquidity_transfer(NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_liquidity_transfer(NUMERIC, DATE, TEXT, TEXT) TO authenticated;

-- Старият превод само в app_settings вече не се ползва от UI
DROP FUNCTION IF EXISTS public.transfer_liquidity(TEXT, TEXT, NUMERIC);
