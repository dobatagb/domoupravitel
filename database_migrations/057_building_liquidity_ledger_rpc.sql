-- Агрегат каса/сметка от приходи + плащания − разходи (същата логика като в приложението),
-- без RLS върху отделните редове — еднакви числа за admin/editor/viewer.
-- Изпълни в Supabase SQL Editor след 056.

CREATE OR REPLACE FUNCTION public.building_liquidity_ledger()
RETURNS TABLE (
  cash NUMERIC(20, 2),
  bank NUMERIC(20, 2),
  income_cash NUMERIC(20, 2),
  income_bank NUMERIC(20, 2),
  payment_cash NUMERIC(20, 2),
  payment_bank NUMERIC(20, 2),
  expense_cash NUMERIC(20, 2),
  expense_bank NUMERIC(20, 2)
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
            WHEN COALESCE(i.received_to, 'cash'::TEXT) IS DISTINCT FROM 'bank_transfer' THEN i.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS c,
      COALESCE(SUM(CASE WHEN i.received_to = 'bank_transfer' THEN i.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS b
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
            WHEN COALESCE(e.paid_from, 'cash'::TEXT) IS DISTINCT FROM 'bank_transfer' THEN e.amount
            ELSE 0::NUMERIC
          END
        ),
        0::NUMERIC
      ) AS c,
      COALESCE(SUM(CASE WHEN e.paid_from = 'bank_transfer' THEN e.amount ELSE 0::NUMERIC END), 0::NUMERIC) AS b
    FROM public.expenses e
  )
  SELECT
    (inc.c + pay.c - exp.c)::NUMERIC(20, 2),
    (inc.b + pay.b - exp.b)::NUMERIC(20, 2),
    inc.c::NUMERIC(20, 2),
    inc.b::NUMERIC(20, 2),
    pay.c::NUMERIC(20, 2),
    pay.b::NUMERIC(20, 2),
    exp.c::NUMERIC(20, 2),
    exp.b::NUMERIC(20, 2)
  FROM inc
  CROSS JOIN pay
  CROSS JOIN exp;
$$;

COMMENT ON FUNCTION public.building_liquidity_ledger() IS
  'Салдо каса/сметка: sum(income) + sum(payments) − sum(expenses) по източник.';

REVOKE ALL ON FUNCTION public.building_liquidity_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.building_liquidity_ledger() TO authenticated;
