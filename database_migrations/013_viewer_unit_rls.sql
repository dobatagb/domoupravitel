-- Преглед (viewer): само данни за единици от user_unit_links. Админ/редактор: без промяна.
-- Изпълни след 012. Идемпотентно: маха стари политики по име и създава нови.

DROP POLICY IF EXISTS "units_select_scope" ON public.units;
DROP POLICY IF EXISTS "payments_select_scope" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_editors" ON public.payments;
DROP POLICY IF EXISTS "payments_update_editors" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_editors" ON public.payments;
DROP POLICY IF EXISTS "income_select_scope" ON public.income;
DROP POLICY IF EXISTS "income_insert_admins" ON public.income;
DROP POLICY IF EXISTS "income_update_admins" ON public.income;
DROP POLICY IF EXISTS "income_delete_admins" ON public.income;
DROP POLICY IF EXISTS "expenses_select_scope" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert_admins" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update_admins" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete_admins" ON public.expenses;
DROP POLICY IF EXISTS "expense_distributions_select_scope" ON public.expense_distributions;
DROP POLICY IF EXISTS "expense_distributions_insert_admins" ON public.expense_distributions;
DROP POLICY IF EXISTS "expense_distributions_update_admins" ON public.expense_distributions;
DROP POLICY IF EXISTS "expense_distributions_delete_admins" ON public.expense_distributions;
DROP POLICY IF EXISTS "documents_select_scope" ON public.documents;

-- ========== units ==========
DROP POLICY IF EXISTS "Anyone can view units" ON public.units;
CREATE POLICY "units_select_scope"
  ON public.units FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = units.id
    )
  );

-- ========== payments ==========
DROP POLICY IF EXISTS "Anyone can view payments" ON public.payments;
DROP POLICY IF EXISTS "Only admins can manage payments" ON public.payments;
DROP POLICY IF EXISTS "Editors can manage payments" ON public.payments;

CREATE POLICY "payments_select_scope"
  ON public.payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = payments.unit_id
    )
  );

CREATE POLICY "payments_insert_editors"
  ON public.payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "payments_update_editors"
  ON public.payments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "payments_delete_editors"
  ON public.payments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  );

-- ========== income ==========
DROP POLICY IF EXISTS "Anyone can view income" ON public.income;
DROP POLICY IF EXISTS "Only admins can manage income" ON public.income;

CREATE POLICY "income_select_scope"
  ON public.income FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR (
      unit_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_unit_links l
        WHERE l.user_id = auth.uid() AND l.unit_id = income.unit_id
      )
    )
  );

CREATE POLICY "income_insert_admins"
  ON public.income FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "income_update_admins"
  ON public.income FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

CREATE POLICY "income_delete_admins"
  ON public.income FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- ========== expenses ==========
DROP POLICY IF EXISTS "Anyone can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Only admins can manage expenses" ON public.expenses;

CREATE POLICY "expenses_select_scope"
  ON public.expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.expense_distributions ed
      WHERE ed.expense_id = expenses.id
      AND ed.unit_id IN (
        SELECT l.unit_id FROM public.user_unit_links l WHERE l.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "expenses_insert_admins"
  ON public.expenses FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE POLICY "expenses_update_admins"
  ON public.expenses FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "expenses_delete_admins"
  ON public.expenses FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ========== expense_distributions ==========
DROP POLICY IF EXISTS "Anyone can view expense distributions" ON public.expense_distributions;
DROP POLICY IF EXISTS "Only admins can manage expense distributions" ON public.expense_distributions;

CREATE POLICY "expense_distributions_select_scope"
  ON public.expense_distributions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = expense_distributions.unit_id
    )
  );

CREATE POLICY "expense_distributions_insert_admins"
  ON public.expense_distributions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

CREATE POLICY "expense_distributions_update_admins"
  ON public.expense_distributions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

CREATE POLICY "expense_distributions_delete_admins"
  ON public.expense_distributions FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ========== documents ==========
DROP POLICY IF EXISTS "Anyone can view documents" ON public.documents;

CREATE POLICY "documents_select_scope"
  ON public.documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR (
      documents.related_type = 'unit'
      AND documents.related_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_unit_links l
        WHERE l.user_id = auth.uid() AND l.unit_id = documents.related_id
      )
    )
    OR (documents.related_type IS NULL AND documents.related_id IS NULL)
  );

-- Политиките за промяна на documents остават само за админ (както в database_v2)
