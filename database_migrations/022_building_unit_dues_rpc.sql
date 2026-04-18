-- Агрегирано „неплатено“ по единица за UI (вкл. viewer), без да зависи от RLS върху всеки ред unit_obligations.
-- Изпълни в Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.building_unit_dues()
RETURNS TABLE (unit_id UUID, total_remaining NUMERIC(12, 2))
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT uo.unit_id, COALESCE(SUM(uo.amount_remaining), 0)::NUMERIC(12, 2)
  FROM public.unit_obligations uo
  GROUP BY uo.unit_id;
$$;

COMMENT ON FUNCTION public.building_unit_dues() IS
  'Сума amount_remaining по unit_id за таблици „Неплатено по единици“; обхожда RLS за четене на агрегат.';

REVOKE ALL ON FUNCTION public.building_unit_dues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.building_unit_dues() TO authenticated;
