-- 1) Документи: външен линк вместо само файл
-- 2) Разходи: от кой източник (каса/сметка) + проследяване на наличност за нови записи
-- 3) Потребители: последна активност
-- 4) Тригер за разходи → app_settings; RPC за прехвърляне каса ↔ сметка
-- Изисква: 017, 048, 030 (редактори и разходи), is_editor_or_admin (015)

-- ========== documents ==========
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS external_url TEXT;

ALTER TABLE public.documents
  ALTER COLUMN file_path DROP NOT NULL;

ALTER TABLE public.documents
  ALTER COLUMN file_type DROP NOT NULL;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_file_or_url_chk;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_file_or_url_chk CHECK (
    (external_url IS NOT NULL AND length(trim(external_url)) > 0)
    OR (
      file_path IS NOT NULL
      AND coalesce(trim(file_path), '') <> ''
      AND file_type IS NOT NULL
      AND length(trim(file_type)) > 0
    )
  );

COMMENT ON COLUMN public.documents.external_url IS 'Публичен URL; ако е зададен, няма качен файл в Storage.';

-- ========== expenses: източник + дали движи наличността (само нови записи) ==========
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_from TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_paid_from_chk;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_paid_from_chk
  CHECK (paid_from IN ('cash', 'bank_transfer'));

COMMENT ON COLUMN public.expenses.paid_from IS 'cash = каса, bank_transfer = банкова сметка; намалява съответната наличност.';

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS liquidity_tracked BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.expenses.liquidity_tracked IS 'false = исторически разход, не коригира наличност; true = нови записи.';

UPDATE public.expenses SET liquidity_tracked = false;

-- ========== users: последна активност (пише се от клиента) ==========
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.last_active_at IS 'Последен контакт с приложението (клиент).';

-- ========== Тригер: разходи ↔ наличности ==========
CREATE OR REPLACE FUNCTION public.trg_expenses_apply_liquidity()
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
    IF r.paid_from = 'cash' THEN
      v_cash_delta := -r.amount;
    ELSE
      v_bank_delta := -r.amount;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    r := OLD;
    IF NOT COALESCE(r.liquidity_tracked, false) THEN
      RETURN OLD;
    END IF;
    IF r.paid_from = 'cash' THEN
      v_cash_delta := r.amount;
    ELSE
      v_bank_delta := r.amount;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF COALESCE(OLD.liquidity_tracked, false) THEN
      IF OLD.paid_from = 'cash' THEN
        v_cash_delta := v_cash_delta + OLD.amount;
      ELSE
        v_bank_delta := v_bank_delta + OLD.amount;
      END IF;
    END IF;
    IF COALESCE(NEW.liquidity_tracked, false) THEN
      IF NEW.paid_from = 'cash' THEN
        v_cash_delta := v_cash_delta - NEW.amount;
      ELSE
        v_bank_delta := v_bank_delta - NEW.amount;
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

DROP TRIGGER IF EXISTS trg_expenses_apply_liquidity ON public.expenses;
CREATE TRIGGER trg_expenses_apply_liquidity
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_expenses_apply_liquidity();

-- ========== Прехвърляне каса ↔ сметка ==========
CREATE OR REPLACE FUNCTION public.transfer_liquidity(
  p_from TEXT,
  p_to TEXT,
  p_amount NUMERIC(20, 2)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC(20, 2);
  v_bank NUMERIC(20, 2);
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Невалидна посока';
  END IF;
  IF p_from NOT IN ('cash', 'bank_transfer') OR p_to NOT IN ('cash', 'bank_transfer') THEN
    RAISE EXCEPTION 'Невалиден източник';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Невалидна сума';
  END IF;

  SELECT cash_opening_balance, COALESCE(bank_account_balance, 0::NUMERIC(20, 2))
  INTO v_cash, v_bank
  FROM public.app_settings
  WHERE id = 1
  FOR UPDATE;

  IF p_from = 'cash' AND v_cash < p_amount THEN
    RAISE EXCEPTION 'Недостатъчна наличност в каса';
  END IF;
  IF p_from = 'bank_transfer' AND v_bank < p_amount THEN
    RAISE EXCEPTION 'Недостатъчна наличност по сметка';
  END IF;

  IF p_from = 'cash' AND p_to = 'bank_transfer' THEN
    UPDATE public.app_settings
    SET
      cash_opening_balance = cash_opening_balance - p_amount,
      bank_account_balance = COALESCE(bank_account_balance, 0::NUMERIC(20, 2)) + p_amount,
      updated_at = NOW()
    WHERE id = 1;
  ELSIF p_from = 'bank_transfer' AND p_to = 'cash' THEN
    UPDATE public.app_settings
    SET
      bank_account_balance = COALESCE(bank_account_balance, 0::NUMERIC(20, 2)) - p_amount,
      cash_opening_balance = cash_opening_balance + p_amount,
      updated_at = NOW()
    WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Невалидна комбинация';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.transfer_liquidity(TEXT, TEXT, NUMERIC) IS
  'Прехвърля сума между каса (cash) и сметка (bank_transfer) в app_settings.';

REVOKE ALL ON FUNCTION public.transfer_liquidity(TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_liquidity(TEXT, TEXT, NUMERIC) TO authenticated;
