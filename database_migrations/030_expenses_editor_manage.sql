-- Редактори (домоуправители) управляват разходи като администраторите — в съответствие с UI (canEdit).

DROP POLICY IF EXISTS "expenses_insert_admins" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update_admins" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete_admins" ON public.expenses;

CREATE POLICY "expenses_insert_editors"
  ON public.expenses FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

CREATE POLICY "expenses_update_editors"
  ON public.expenses FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

CREATE POLICY "expenses_delete_editors"
  ON public.expenses FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "expense_distributions_insert_admins" ON public.expense_distributions;
DROP POLICY IF EXISTS "expense_distributions_update_admins" ON public.expense_distributions;
DROP POLICY IF EXISTS "expense_distributions_delete_admins" ON public.expense_distributions;

CREATE POLICY "expense_distributions_insert_editors"
  ON public.expense_distributions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

CREATE POLICY "expense_distributions_update_editors"
  ON public.expense_distributions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

CREATE POLICY "expense_distributions_delete_editors"
  ON public.expense_distributions FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));
