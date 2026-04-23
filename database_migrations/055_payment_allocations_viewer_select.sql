-- Viewer вижда всички плащания (021), но вложените payment_allocations бяха
-- скрити освен за плащания по свързан unit — тогава в UI липсва „Приспадане: …“.
-- Подравняваме с прозрачността за сградата: SELECT за payment_allocations като за payments.

DROP POLICY IF EXISTS "payment_allocations_select_scope" ON public.payment_allocations;
CREATE POLICY "payment_allocations_select_scope"
  ON public.payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_allocations.payment_id
        AND (
          EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
          )
          OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'viewer'
          )
          OR EXISTS (
            SELECT 1 FROM public.user_unit_links l
            WHERE l.user_id = auth.uid() AND l.unit_id = p.unit_id
          )
        )
    )
  );
