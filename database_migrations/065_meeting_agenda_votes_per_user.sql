-- Един глас на потребител по точка (не по всеки обект).
-- Ид. части за резултат: сумират се всички присъстващи обекти на потребителя.
-- Изисква: 064 или еквивалентни meeting_agenda_* таблици.

DROP POLICY IF EXISTS "meeting_agenda_votes_insert" ON public.meeting_agenda_votes;
DROP POLICY IF EXISTS "meeting_agenda_votes_update" ON public.meeting_agenda_votes;
DROP POLICY IF EXISTS "meeting_agenda_votes_delete" ON public.meeting_agenda_votes;
DROP POLICY IF EXISTS "meeting_agenda_votes_select_auth" ON public.meeting_agenda_votes;

DROP TRIGGER IF EXISTS trg_meeting_agenda_votes_voted_at ON public.meeting_agenda_votes;

DROP TABLE IF EXISTS public.meeting_agenda_votes;

DROP FUNCTION IF EXISTS public.can_vote_meeting_unit(UUID, UUID);

CREATE TABLE public.meeting_agenda_votes (
  agenda_item_id UUID NOT NULL REFERENCES public.meeting_agenda_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agenda_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_votes_user ON public.meeting_agenda_votes (user_id);

COMMENT ON TABLE public.meeting_agenda_votes IS 'Един глас на регистриран потребител по точка; тежест в резултатите = сума ид. части по неговите присъстващи обекти.';

CREATE OR REPLACE FUNCTION public.can_vote_meeting_agenda_item(p_agenda_item_id UUID)
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
    INNER JOIN public.user_unit_links uul ON uul.unit_id = ma.unit_id AND uul.user_id = auth.uid()
    WHERE ai.id = p_agenda_item_id
  );
$$;

COMMENT ON FUNCTION public.can_vote_meeting_agenda_item(UUID) IS 'TRUE ако текущият потребител има поне един присъстващ обект за това събране.';

GRANT EXECUTE ON FUNCTION public.can_vote_meeting_agenda_item(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_meeting_agenda_votes_voted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.voted_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_meeting_agenda_votes_voted_at
  BEFORE UPDATE ON public.meeting_agenda_votes
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meeting_agenda_votes_voted_at();

ALTER TABLE public.meeting_agenda_votes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_agenda_votes TO authenticated;
GRANT ALL ON public.meeting_agenda_votes TO service_role;

DROP POLICY IF EXISTS "meeting_agenda_votes_select_auth" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_select_auth"
  ON public.meeting_agenda_votes FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_agenda_votes_insert" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_insert"
  ON public.meeting_agenda_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_vote_meeting_agenda_item(agenda_item_id)
  );

DROP POLICY IF EXISTS "meeting_agenda_votes_update" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_update"
  ON public.meeting_agenda_votes FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.can_vote_meeting_agenda_item(agenda_item_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_vote_meeting_agenda_item(agenda_item_id)
  );

DROP POLICY IF EXISTS "meeting_agenda_votes_delete" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_delete"
  ON public.meeting_agenda_votes FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.can_vote_meeting_agenda_item(agenda_item_id)
  );
