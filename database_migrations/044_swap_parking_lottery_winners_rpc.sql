-- Атомарна размяна на двама печеливши между два реда.
-- Единичен UPDATE дава 409: UNIQUE(lottery_id, user_id) се проверява ред по ред.
-- Тук: изтриване на двата реда и вмъкване с разменени user_id / email / is_repeat.

CREATE OR REPLACE FUNCTION public.swap_parking_lottery_winners(p_id_a uuid, p_id_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ra RECORD;
  rb RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Няма активна сесия.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Само администратор или редактор може да пренарежда.';
  END IF;

  IF p_id_a = p_id_b THEN
    RAISE EXCEPTION 'Невалидна двойка редове.';
  END IF;

  SELECT * INTO ra FROM public.parking_lottery_results WHERE id = p_id_a FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Редът не е намерен.';
  END IF;

  SELECT * INTO rb FROM public.parking_lottery_results WHERE id = p_id_b FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Редът не е намерен.';
  END IF;

  IF ra.lottery_id IS DISTINCT FROM rb.lottery_id THEN
    RAISE EXCEPTION 'Редовете трябва да са от една и съща томбола.';
  END IF;

  DELETE FROM public.parking_lottery_results WHERE id IN (p_id_a, p_id_b);

  INSERT INTO public.parking_lottery_results (
    id, lottery_id, unit_id, parking_label, user_id, email, sort_order, is_repeat
  )
  VALUES
    (ra.id, ra.lottery_id, ra.unit_id, ra.parking_label, rb.user_id, rb.email, ra.sort_order, rb.is_repeat),
    (rb.id, rb.lottery_id, rb.unit_id, rb.parking_label, ra.user_id, ra.email, rb.sort_order, ra.is_repeat);
END;
$$;

REVOKE ALL ON FUNCTION public.swap_parking_lottery_winners(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_parking_lottery_winners(uuid, uuid) TO authenticated;
