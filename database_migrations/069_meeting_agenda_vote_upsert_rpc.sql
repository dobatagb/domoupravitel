-- Обединен upsert за глас без директен REST към таблицата (избягва 403 при INSERT…ON CONFLICT + RLS).
-- Изисква: 068 (meeting_agenda_target_* , политики).

CREATE OR REPLACE FUNCTION public.meeting_agenda_vote_upsert(
  p_agenda_item_id UUID,
  p_vote TEXT,
  p_target_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_subject UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_vote NOT IN ('for', 'against', 'abstain') THEN
    RAISE EXCEPTION 'Invalid vote';
  END IF;

  v_subject := COALESCE(p_target_user_id, v_actor);

  IF p_target_user_id IS NULL THEN
    IF NOT public.can_vote_meeting_agenda_item(p_agenda_item_id) THEN
      RAISE EXCEPTION 'Not allowed to vote on this item';
    END IF;
  ELSE
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admin can record votes for others';
    END IF;
    IF NOT public.meeting_agenda_target_may_vote(p_agenda_item_id, v_subject) THEN
      RAISE EXCEPTION 'Target user cannot vote on this item';
    END IF;
  END IF;

  INSERT INTO public.meeting_agenda_votes (agenda_item_id, user_id, vote)
  VALUES (p_agenda_item_id, v_subject, p_vote)
  ON CONFLICT (agenda_item_id, user_id)
  DO UPDATE SET vote = EXCLUDED.vote;
END;
$$;

COMMENT ON FUNCTION public.meeting_agenda_vote_upsert(UUID, TEXT, UUID) IS
  'Upsert на глас: без p_target_user_id — за текущия потребител; с id — само за администратор (ръчен запис).';

GRANT EXECUTE ON FUNCTION public.meeting_agenda_vote_upsert(UUID, TEXT, UUID) TO authenticated;
