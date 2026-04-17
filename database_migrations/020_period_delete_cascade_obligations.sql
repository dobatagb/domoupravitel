-- При изтриване на billing_period да се изтриват и unit_obligations за този период.
-- payment_allocations към тези задължения съще се изтриват (плащането в payments остава).
-- Редове с billing_period_id NULL (напр. „Пренесен дълг“) не се пипат.

ALTER TABLE public.unit_obligations
  DROP CONSTRAINT IF EXISTS unit_obligations_billing_period_id_fkey;

ALTER TABLE public.unit_obligations
  ADD CONSTRAINT unit_obligations_billing_period_id_fkey
  FOREIGN KEY (billing_period_id) REFERENCES public.billing_periods(id) ON DELETE CASCADE;

ALTER TABLE public.payment_allocations
  DROP CONSTRAINT IF EXISTS payment_allocations_unit_obligation_id_fkey;

ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_unit_obligation_id_fkey
  FOREIGN KEY (unit_obligation_id) REFERENCES public.unit_obligations(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT unit_obligations_billing_period_id_fkey ON public.unit_obligations IS
  'Изтриване на период изтрива и тарифните задължения към него.';
COMMENT ON CONSTRAINT payment_allocations_unit_obligation_id_fkey ON public.payment_allocations IS
  'При изтриване на задължение се премахва приспадането; записът в payments остава.';
