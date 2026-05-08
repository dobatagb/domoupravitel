-- Ръчен запис на глас от администратор за собственик без приложение (на място на събранието).
-- Изисква: 066 (voting_status в can_vote_meeting_agenda_item).

CREATE OR REPLACE FUNCTION public.meeting_agenda_target_owner(
  p_agenda_item_id UUID,
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_agenda_items ai
    INNER JOIN public.meeting_attendees ma ON ma.meeting_id = ai.meeting_id
    INNER JOIN public.user_unit_links uul
      ON uul.unit_id = ma.unit_id AND uul.user_id = p_target_user_id
    WHERE ai.id = p_agenda_item_id
  );
$$;

COMMENT ON FUNCTION public.meeting_agenda_target_owner(UUID, UUID) IS
  'TRUE ако потребителят е собственик поне на един присъстващ обект за събранието на тази точка.';

CREATE OR REPLACE FUNCTION public.meeting_agenda_target_may_vote(
  p_agenda_item_id UUID,
  p_target_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_agenda_items ai
    INNER JOIN public.meeting_attendees ma ON ma.meeting_id = ai.meeting_id
    INNER JOIN public.user_unit_links uul
      ON uul.unit_id = ma.unit_id AND uul.user_id = p_target_user_id
    WHERE ai.id = p_agenda_item_id
      AND ai.voting_status = 'open'
  );
$$;

COMMENT ON FUNCTION public.meeting_agenda_target_may_vote(UUID, UUID) IS
  'TRUE ако точката е отворена и потребителят има право на глас (присъстващ обект).';

GRANT EXECUTE ON FUNCTION public.meeting_agenda_target_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_agenda_target_may_vote(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "meeting_agenda_votes_insert" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_insert"
  ON public.meeting_agenda_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      user_id = auth.uid()
      AND public.can_vote_meeting_agenda_item(agenda_item_id)
    )
    OR (
      public.is_admin()
      AND public.meeting_agenda_target_may_vote(agenda_item_id, user_id)
    )
  );

DROP POLICY IF EXISTS "meeting_agenda_votes_update" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_update"
  ON public.meeting_agenda_votes FOR UPDATE
  TO authenticated
  USING (
    (
      user_id = auth.uid()
      AND public.can_vote_meeting_agenda_item(agenda_item_id)
    )
    OR (
      public.is_admin()
      AND public.meeting_agenda_target_may_vote(agenda_item_id, user_id)
    )
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      AND public.can_vote_meeting_agenda_item(agenda_item_id)
    )
    OR (
      public.is_admin()
      AND public.meeting_agenda_target_may_vote(agenda_item_id, user_id)
    )
  );

DROP POLICY IF EXISTS "meeting_agenda_votes_delete" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_delete"
  ON public.meeting_agenda_votes FOR DELETE
  TO authenticated
  USING (
    (
      user_id = auth.uid()
      AND public.can_vote_meeting_agenda_item(agenda_item_id)
    )
    OR (
      public.is_admin()
      AND public.meeting_agenda_target_owner(agenda_item_id, user_id)
    )
  );
