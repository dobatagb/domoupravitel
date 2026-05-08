-- Събрания: час за кворум и присъстващи по обект (ид. части).
-- Изисква: 061 (is_admin), 012 (user_unit_links), units.building_ideal_share_percent (059).

-- Един източник на „сега“ за клиента (фази първо/второ свикване).
CREATE OR REPLACE FUNCTION public.server_now()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
  SELECT clock_timestamp();
$$;

COMMENT ON FUNCTION public.server_now IS 'Сървърно време за изчисляване на фаза на събрание (кворум).';

GRANT EXECUTE ON FUNCTION public.server_now() TO authenticated;

CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  convening_started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_convening_started ON public.meetings (convening_started_at DESC);

COMMENT ON TABLE public.meetings IS 'Общо събрание; convening_started_at — начало на отброяване за фази кворум (1 ч / след 1 ч).';

CREATE TABLE IF NOT EXISTS public.meeting_attendees (
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  attendee_name TEXT,
  PRIMARY KEY (meeting_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_unit ON public.meeting_attendees (unit_id);

COMMENT ON TABLE public.meeting_attendees IS 'Присъстващ обект на събрание; по избор име на представител.';

CREATE OR REPLACE FUNCTION public.meetings_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW
  EXECUTE PROCEDURE public.meetings_touch_updated_at();

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendees ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_attendees TO authenticated;
GRANT ALL ON public.meetings TO service_role;
GRANT ALL ON public.meeting_attendees TO service_role;

DROP POLICY IF EXISTS "meetings_select_authenticated" ON public.meetings;
CREATE POLICY "meetings_select_authenticated"
  ON public.meetings FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meetings_insert_admin" ON public.meetings;
CREATE POLICY "meetings_insert_admin"
  ON public.meetings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meetings_update_admin" ON public.meetings;
CREATE POLICY "meetings_update_admin"
  ON public.meetings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meetings_delete_admin" ON public.meetings;
CREATE POLICY "meetings_delete_admin"
  ON public.meetings FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "meeting_attendees_select_authenticated" ON public.meeting_attendees;
CREATE POLICY "meeting_attendees_select_authenticated"
  ON public.meeting_attendees FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_attendees_insert_admin" ON public.meeting_attendees;
CREATE POLICY "meeting_attendees_insert_admin"
  ON public.meeting_attendees FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meeting_attendees_update_admin" ON public.meeting_attendees;
CREATE POLICY "meeting_attendees_update_admin"
  ON public.meeting_attendees FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "meeting_attendees_delete_admin" ON public.meeting_attendees;
CREATE POLICY "meeting_attendees_delete_admin"
  ON public.meeting_attendees FOR DELETE
  TO authenticated
  USING (public.is_admin());
