-- Съобщения от домоуправителя към всички регистрирани потребители.

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_created ON public.announcements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON public.announcements (pinned DESC, created_at DESC);

COMMENT ON TABLE public.announcements IS 'Обявления за всички автентикирани потребители; запис само admin/editor.';

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select_authenticated" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_logged_in" ON public.announcements;

-- Виж и database_migrations/033_announcements_grants_and_select.sql за GRANT + същата политика при ъпгрейд.
CREATE POLICY "announcements_select_logged_in"
  ON public.announcements FOR SELECT
  USING (auth.uid() IS NOT NULL);

GRANT SELECT ON TABLE public.announcements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;

DROP POLICY IF EXISTS "announcements_insert_editors" ON public.announcements;
CREATE POLICY "announcements_insert_editors"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "announcements_update_editors" ON public.announcements;
CREATE POLICY "announcements_update_editors"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "announcements_delete_editors" ON public.announcements;
CREATE POLICY "announcements_delete_editors"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));
