-- Редактори (домоуправители) създават/редактират/трият обекти като администраторите — в съответствие с UI (canEdit), вкл. квадратура (area).

DROP POLICY IF EXISTS "Only admins can insert units" ON public.units;
DROP POLICY IF EXISTS "Only admins can update units" ON public.units;
DROP POLICY IF EXISTS "Only admins can delete units" ON public.units;

CREATE POLICY "units_insert_editors"
  ON public.units FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

CREATE POLICY "units_update_editors"
  ON public.units FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

CREATE POLICY "units_delete_editors"
  ON public.units FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));
