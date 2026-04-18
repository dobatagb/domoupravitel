-- Преглед (viewer): прозрачност за сградата (всички единици, задължения, плащания, разходи)
-- и редакция само на контакти по единици от user_unit_links.
-- Изпълни след 013, 015, 017.

-- ========== тригер: viewer да не променя счетоводни полета ==========
CREATE OR REPLACE FUNCTION public.units_enforce_viewer_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'viewer'
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.area IS DISTINCT FROM OLD.area
       OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Като собственик може да редактирате само контактите и бележките за вашите единици.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_units_viewer_guard ON public.units;
CREATE TRIGGER trg_units_viewer_guard
  BEFORE UPDATE ON public.units
  FOR EACH ROW
  EXECUTE PROCEDURE public.units_enforce_viewer_update();

-- ========== units: всички виждат единиите; viewer може UPDATE само за свързани ==========
DROP POLICY IF EXISTS "units_select_scope" ON public.units;
CREATE POLICY "units_select_scope"
  ON public.units FOR SELECT
  USING (
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
      WHERE l.user_id = auth.uid() AND l.unit_id = units.id
    )
  );

DROP POLICY IF EXISTS "units_update_viewer_linked" ON public.units;
CREATE POLICY "units_update_viewer_linked"
  ON public.units FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'viewer'
    )
    AND EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = units.id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'viewer'
    )
    AND EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = units.id
    )
  );

-- ========== unit_obligations: viewer вижда всички (справка по сградата) ==========
DROP POLICY IF EXISTS "unit_obligations_select_scope" ON public.unit_obligations;
CREATE POLICY "unit_obligations_select_scope"
  ON public.unit_obligations FOR SELECT
  USING (
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
      WHERE l.user_id = auth.uid() AND l.unit_id = unit_obligations.unit_id
    )
  );

-- ========== payments: viewer вижда всички плащания ==========
DROP POLICY IF EXISTS "payments_select_scope" ON public.payments;
CREATE POLICY "payments_select_scope"
  ON public.payments FOR SELECT
  USING (
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
      WHERE l.user_id = auth.uid() AND l.unit_id = payments.unit_id
    )
  );

-- ========== expenses: viewer вижда всички разходи ==========
DROP POLICY IF EXISTS "expenses_select_scope" ON public.expenses;
CREATE POLICY "expenses_select_scope"
  ON public.expenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'viewer'
    )
    OR EXISTS (
      SELECT 1 FROM public.expense_distributions ed
      WHERE ed.expense_id = expenses.id
        AND ed.unit_id IN (
          SELECT l.unit_id FROM public.user_unit_links l WHERE l.user_id = auth.uid()
        )
    )
  );

-- ========== documents: viewer вижда всички документи (прочитане) ==========
DROP POLICY IF EXISTS "documents_select_scope" ON public.documents;
CREATE POLICY "documents_select_scope"
  ON public.documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'viewer'
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
