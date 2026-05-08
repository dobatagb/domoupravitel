-- Поправка: 400 от RPC — без set_config(row_security) (може да отказва без superuser);
-- две изрични функции без DEFAULT параметър (PostgREST избира overload по-безпроблемно);
-- връща JSON за отговор от /rpc.
-- Изисква: 068, (старото име meeting_agenda_vote_upsert от 069).

DROP FUNCTION IF EXISTS public.meeting_agenda_vote_upsert(UUID, TEXT, UUID);

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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Invalid vote';
  END IF;
  IF NOT public.can_vote_meeting_agenda_item(p_agenda_item_id) THEN
    RAISE EXCEPTION 'Not allowed to vote on this item';
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Invalid vote';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can record votes for others';
  END IF;
  IF NOT public.meeting_agenda_target_may_vote(p_agenda_item_id, p_target_user_id) THEN
    RAISE EXCEPTION 'Target user cannot vote on this item';
  END IF;

  INSERT INTO public.meeting_agenda_votes (agenda_item_id, user_id, vote)
  VALUES (p_agenda_item_id, p_target_user_id, p_vote)
  ON CONFLICT (agenda_item_id, user_id)
  DO UPDATE SET vote = EXCLUDED.vote;

  RETURN '{}'::json;
END;
$$;

COMMENT ON FUNCTION public.meeting_agenda_vote_upsert_self(UUID, TEXT) IS
  'Upsert на глас за текущия потребител (собственик с право на глас).';

COMMENT ON FUNCTION public.meeting_agenda_vote_upsert_for_user(UUID, TEXT, UUID) IS
  'Upsert на глас от администратор за избран собственик.';

GRANT EXECUTE ON FUNCTION public.meeting_agenda_vote_upsert_self(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_agenda_vote_upsert_for_user(UUID, TEXT, UUID) TO authenticated;
