-- Плащания: същите права като другите екрани (admin + editor), не само admin.
-- Изпълни в Supabase → SQL Editor.

DROP POLICY IF EXISTS "Only admins can manage payments" ON public.payments;
DROP POLICY IF EXISTS "Editors can manage payments" ON public.payments;

CREATE POLICY "Editors can manage payments"
  ON public.payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );
