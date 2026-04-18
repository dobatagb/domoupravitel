-- Обновява user_unit_links за паркоместата според резултата от завършена томбола.
-- За всяко паркомясто: премахва старите връзки към този unit_id, добавя връзка към печелившия.

CREATE OR REPLACE FUNCTION public.apply_parking_lottery_unit_links(p_lottery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Няма активна сесия.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Само администратор или редактор.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.parking_lotteries l
    WHERE l.id = p_lottery_id AND l.drawn_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Томболата няма завършено теглене.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.parking_lottery_results r WHERE r.lottery_id = p_lottery_id
  ) THEN
    RAISE EXCEPTION 'Няма записани резултати.';
  END IF;

  FOR r IN
    SELECT unit_id, user_id FROM public.parking_lottery_results WHERE lottery_id = p_lottery_id
  LOOP
    DELETE FROM public.user_unit_links WHERE unit_id = r.unit_id;
    INSERT INTO public.user_unit_links (user_id, unit_id) VALUES (r.user_id, r.unit_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_parking_lottery_unit_links(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_parking_lottery_unit_links(uuid) TO authenticated;
