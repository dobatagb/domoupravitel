-- Точки за гласуване по събране + гласове по присъстващ обект (ид. части за резултат).
-- Изисква: 062 (meetings, meeting_attendees), 012 (user_unit_links), is_admin (061).

CREATE TABLE IF NOT EXISTS public.meeting_agenda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_items_meeting ON public.meeting_agenda_items (meeting_id, sort_order);

COMMENT ON TABLE public.meeting_agenda_items IS 'Точки от дневен ред за гласуване; добавя само администратор.';

CREATE TABLE IF NOT EXISTS public.meeting_agenda_votes (
  agenda_item_id UUID NOT NULL REFERENCES public.meeting_agenda_items(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agenda_item_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_votes_unit ON public.meeting_agenda_votes (unit_id);

COMMENT ON TABLE public.meeting_agenda_votes IS 'Глас по точка и обект; само присъстващ в събранието обект, свързан с текущия потребител.';

CREATE OR REPLACE FUNCTION public.can_vote_meeting_unit(p_agenda_item_id UUID, p_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meeting_agenda_items ai
    INNER JOIN public.meeting_attendees ma
      ON ma.meeting_id = ai.meeting_id AND ma.unit_id = p_unit_id
    INNER JOIN public.user_unit_links uul
      ON uul.unit_id = p_unit_id AND uul.user_id = auth.uid()
    WHERE ai.id = p_agenda_item_id
  );
$$;

COMMENT ON FUNCTION public.can_vote_meeting_unit(UUID, UUID) IS 'TRUE ако обектът е присъстващ на събранието за точката и е свързан с текущия потребител.';

GRANT EXECUTE ON FUNCTION public.can_vote_meeting_unit(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_meeting_agenda_votes_voted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.voted_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_agenda_votes_voted_at ON public.meeting_agenda_votes;
CREATE TRIGGER trg_meeting_agenda_votes_voted_at
  BEFORE UPDATE ON public.meeting_agenda_votes
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_meeting_agenda_votes_voted_at();

ALTER TABLE public.meeting_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_agenda_votes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_agenda_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_agenda_votes TO authenticated;
GRANT ALL ON public.meeting_agenda_items TO service_role;
GRANT ALL ON public.meeting_agenda_votes TO service_role;

DROP POLICY IF EXISTS "meeting_agenda_items_select_auth" ON public.meeting_agenda_items;
CREATE POLICY "meeting_agenda_items_select_auth"
  ON public.meeting_agenda_items FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_agenda_items_insert_admin" ON public.meeting_agenda_items;
CREATE POLICY "meeting_agenda_items_insert_admin"
  ON public.meeting_agenda_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meeting_agenda_items_update_admin" ON public.meeting_agenda_items;
CREATE POLICY "meeting_agenda_items_update_admin"
  ON public.meeting_agenda_items FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meeting_agenda_items_delete_admin" ON public.meeting_agenda_items;
CREATE POLICY "meeting_agenda_items_delete_admin"
  ON public.meeting_agenda_items FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "meeting_agenda_votes_select_auth" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_select_auth"
  ON public.meeting_agenda_votes FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_agenda_votes_insert" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_insert"
  ON public.meeting_agenda_votes FOR INSERT
  TO authenticated
  WITH CHECK (public.can_vote_meeting_unit(agenda_item_id, unit_id));

DROP POLICY IF EXISTS "meeting_agenda_votes_update" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_update"
  ON public.meeting_agenda_votes FOR UPDATE
  TO authenticated
  USING (public.can_vote_meeting_unit(agenda_item_id, unit_id))
  WITH CHECK (public.can_vote_meeting_unit(agenda_item_id, unit_id));

DROP POLICY IF EXISTS "meeting_agenda_votes_delete" ON public.meeting_agenda_votes;
CREATE POLICY "meeting_agenda_votes_delete"
  ON public.meeting_agenda_votes FOR DELETE
  TO authenticated
  USING (public.can_vote_meeting_unit(agenda_item_id, unit_id));
