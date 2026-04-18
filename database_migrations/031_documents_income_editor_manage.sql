-- Редактори управляват документи и приходи като администраторите (съгласувано с UI canEdit и разходи 030).

-- ========== documents ==========
DROP POLICY IF EXISTS "Only admins can manage documents" ON public.documents;

CREATE POLICY "documents_insert_editors"
  ON public.documents FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

CREATE POLICY "documents_update_editors"
  ON public.documents FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

CREATE POLICY "documents_delete_editors"
  ON public.documents FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

-- ========== income ==========
DROP POLICY IF EXISTS "income_insert_admins" ON public.income;
DROP POLICY IF EXISTS "income_update_admins" ON public.income;
DROP POLICY IF EXISTS "income_delete_admins" ON public.income;

CREATE POLICY "income_insert_editors"
  ON public.income FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

CREATE POLICY "income_update_editors"
  ON public.income FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

CREATE POLICY "income_delete_editors"
  ON public.income FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));
