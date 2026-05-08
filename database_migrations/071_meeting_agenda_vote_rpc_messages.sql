-- По-ясни съобщения при отказ за гласуване (вместо само „Not allowed…“).
-- Замества телата на функциите от 070.

CREATE OR REPLACE FUNCTION public.meeting_agenda_vote_upsert_self(
  p_agenda_item_id UUID,
  p_vote TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_meeting_id UUID;
  v_status TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Не сте влезли в системата.';
  END IF;

  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Невалиден избор за глас.';
  END IF;

  SELECT ai.meeting_id, ai.voting_status
  INTO v_meeting_id, v_status
  FROM public.meeting_agenda_items ai
  WHERE ai.id = p_agenda_item_id;

  IF v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Точката не е намерена.';
  END IF;

  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Точката не е отворена за гласуване (администраторът трябва да я маркира като „Отворена за гласуване“).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_attendees ma WHERE ma.meeting_id = v_meeting_id
  ) THEN
    RAISE EXCEPTION 'Няма записани присъстващи обекти за събранието. Отворете „Присъстващи по обект“ и натиснете „Запази в базата“.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.meeting_attendees ma
    INNER JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id AND uul.user_id = v_actor
    WHERE ma.meeting_id = v_meeting_id
  ) THEN
    RAISE EXCEPTION 'Нямате сред присъстващите маркиран обект, свързан с вашия профил (или липсва връзка собственик–обект в системата).';
  END IF;

  INSERT INTO public.meeting_agenda_votes (agenda_item_id, user_id, vote)
  VALUES (p_agenda_item_id, v_actor, p_vote)
  ON CONFLICT (agenda_item_id, user_id)
  DO UPDATE SET vote = EXCLUDED.vote;

  RETURN '{}'::json;
END;
$$;

CREATE OR REPLACE FUNCTION public.meeting_agenda_vote_upsert_for_user(
  p_agenda_item_id UUID,
  p_vote TEXT,
  p_target_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting_id UUID;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Не сте влезли в системата.';
  END IF;

  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Невалиден избор за глас.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Само администратор може да записва глас за друг собственик.';
  END IF;

  SELECT ai.meeting_id, ai.voting_status
  INTO v_meeting_id, v_status
  FROM public.meeting_agenda_items ai
  WHERE ai.id = p_agenda_item_id;

  IF v_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Точката не е намерена.';
  END IF;

  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Точката не е отворена за гласуване.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.meeting_attendees ma
    INNER JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id AND uul.user_id = p_target_user_id
    WHERE ma.meeting_id = v_meeting_id
  ) THEN
    RAISE EXCEPTION 'Избраният собственик няма сред присъстващите маркиран обект за това събрание или липсва връзка собственик–обект.';
  END IF;

  INSERT INTO public.meeting_agenda_votes (agenda_item_id, user_id, vote)
  VALUES (p_agenda_item_id, p_target_user_id, p_vote)
  ON CONFLICT (agenda_item_id, user_id)
  DO UPDATE SET vote = EXCLUDED.vote;

  RETURN '{}'::json;
END;
$$;

COMMENT ON FUNCTION public.meeting_agenda_vote_upsert_self(UUID, TEXT) IS
  'Upsert на глас за текущия потребител; ясни съобщения при липса на условия.';

COMMENT ON FUNCTION public.meeting_agenda_vote_upsert_for_user(UUID, TEXT, UUID) IS
  'Upsert на глас от администратор за избран собственик.';
