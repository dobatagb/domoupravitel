-- Кой е записал плащане / разход (публичен users.id = auth.users).
-- Стари редове остават с NULL.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_created_by ON public.payments (created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses (created_by);

COMMENT ON COLUMN public.payments.created_by IS 'Потребител, създал записа (при липса — импорт или стари данни).';
COMMENT ON COLUMN public.expenses.created_by IS 'Потребител, създал записа (при липса — стари данни).';

CREATE OR REPLACE FUNCTION public.set_row_created_by_if_null()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_payments_set_created_by ON public.payments;
CREATE TRIGGER tr_payments_set_created_by
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_row_created_by_if_null();

DROP TRIGGER IF EXISTS tr_expenses_set_created_by ON public.expenses;
CREATE TRIGGER tr_expenses_set_created_by
  BEFORE INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_row_created_by_if_null();
