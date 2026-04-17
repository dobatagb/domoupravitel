-- Връзка потребител ↔ много единици (отделно от таблицата units).
-- Ако има старо units.user_id, пренася се тук и колоната се премахва.

CREATE TABLE IF NOT EXISTS public.user_unit_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_unit_links_unique UNIQUE (user_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_user_unit_links_user ON public.user_unit_links (user_id);
CREATE INDEX IF NOT EXISTS idx_user_unit_links_unit ON public.user_unit_links (unit_id);

COMMENT ON TABLE public.user_unit_links IS 'Кои единици са обвързани с входящ потребител (преглед и др.)';

-- Пренасяне от legacy units.user_id (само ако колоната още съществува)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'user_id'
  ) THEN
    INSERT INTO public.user_unit_links (user_id, unit_id)
    SELECT u.user_id, u.id
    FROM public.units u
    WHERE u.user_id IS NOT NULL
    ON CONFLICT (user_id, unit_id) DO NOTHING;
    ALTER TABLE public.units DROP COLUMN user_id;
    DROP INDEX IF EXISTS public.idx_units_user_id;
  END IF;
END $$;

ALTER TABLE public.user_unit_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View user_unit_links" ON public.user_unit_links;
CREATE POLICY "View user_unit_links"
  ON public.user_unit_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Editors manage user_unit_links" ON public.user_unit_links;
CREATE POLICY "Editors manage user_unit_links"
  ON public.user_unit_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "Editors update user_unit_links"
  ON public.user_unit_links FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "Editors delete user_unit_links"
  ON public.user_unit_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );
