-- Трети източник: «фонд ремонт» — приходи/разходи (не плащания от Задължения).
-- Разширява building_liquidity_ledger с repair_fund = приходи(ремонт) − разходи(ремонт).
-- Изпълни в Supabase SQL Editor след 057.

-- ========== income: къде влиза сумата ==========
ALTER TABLE public.income DROP CONSTRAINT IF EXISTS income_received_to_chk;
ALTER TABLE public.income
  ADD CONSTRAINT income_received_to_chk
  CHECK (received_to IN ('cash', 'bank_transfer', 'repair_fund'));
COMMENT ON COLUMN public.income.received_to IS
  'каса / сметка / фонд ремонт (по закон за етажната собственост)';

-- ========== expenses: откъде се плаща ==========
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_paid_from_chk;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_paid_from_chk
  CHECK (paid_from IN ('cash', 'bank_transfer', 'repair_fund'));
COMMENT ON COLUMN public.expenses.paid_from IS
  'каса (в брой) / банкова сметка / фонд ремонт';

-- ========== building_liquidity_ledger: три салда ==========
-- IN/OUT сигнатурата е различна от 057 → трябва DROP, не само OR REPLACE.
DROP FUNCTION IF EXISTS public.building_liquidity_ledger();

CREATE OR REPLACE FUNCTION public.building_liquidity_ledger()
RETURNS TABLE (
  cash NUMERIC(20, 2),
  bank NUMERIC(20, 2),
  repair_fund NUMERIC(20, 2),
  income_cash NUMERIC(20, 2),
  income_bank NUMERIC(20, 2),
  income_repair NUMERIC(20, 2),
  payment_cash NUMERIC(20, 2),
  payment_bank NUMERIC(20, 2),
  expense_cash NUMERIC(20, 2),
  expense_bank NUMERIC(20, 2),
  expense_repair NUMERIC(20, 2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  inc AS (
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN COALESCE(i.received_to, 'cash'::TEXT) IS DISTINCT FROM 'bank_transfer'
                 AND COALESCE(i.received_to, 'cash'::TEXT) IS DISTINCT FROM 'repair_fund'
            THEN i.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS c,
      COALESCE(SUM(CASE WHEN i.received_to = 'bank_transfer' THEN i.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS b,
      COALESCE(SUM(CASE WHEN i.received_to = 'repair_fund' THEN i.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS r
    FROM public.income i
  ),
  pay AS (
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN lower(trim(COALESCE(p.payment_method::TEXT, ''))) = 'cash' THEN p.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS c,
      COALESCE(
        SUM(
          CASE
            WHEN lower(trim(COALESCE(p.payment_method::TEXT, ''))) = 'bank_transfer' THEN p.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS b
    FROM public.payments p
    WHERE p.status = 'paid'
  ),
  exp AS (
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN COALESCE(e.paid_from, 'cash'::TEXT) IS DISTINCT FROM 'bank_transfer'
                 AND COALESCE(e.paid_from, 'cash'::TEXT) IS DISTINCT FROM 'repair_fund'
            THEN e.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS c,
      COALESCE(SUM(CASE WHEN e.paid_from = 'bank_transfer' THEN e.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS b,
      COALESCE(SUM(CASE WHEN e.paid_from = 'repair_fund' THEN e.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS r
    FROM public.expenses e
  )
  SELECT
    (inc.c + pay.c - exp.c)::NUMERIC(20, 2),
    (inc.b + pay.b - exp.b)::NUMERIC(20, 2),
    (inc.r - exp.r)::NUMERIC(20, 2),
    inc.c::NUMERIC(20, 2),
    inc.b::NUMERIC(20, 2),
    inc.r::NUMERIC(20, 2),
    pay.c::NUMERIC(20, 2),
    pay.b::NUMERIC(20, 2),
    exp.c::NUMERIC(20, 2),
    exp.b::NUMERIC(20, 2),
    exp.r::NUMERIC(20, 2)
  FROM inc
  CROSS JOIN pay
  CROSS JOIN exp;
$$;

COMMENT ON FUNCTION public.building_liquidity_ledger() IS
  'Салдо каса, сметка, фонд ремонт: приходи+плащания−разходи (каса/банк), приходи−разходи (ремонт).';

REVOKE ALL ON FUNCTION public.building_liquidity_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.building_liquidity_ledger() TO authenticated;
