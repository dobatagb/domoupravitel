-- Номенклатура: групи обекти (unit_groups) + връзка към units.
-- Изпълни в Supabase → SQL Editor. Идемпотентно за повторно пускане (където е приложимо).

-- 1) Таблица и начални записи
CREATE TABLE IF NOT EXISTS public.unit_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.unit_groups (code, name, sort_order) VALUES
  ('apartment', 'Апартамент', 10),
  ('shop', 'Магазин', 20),
  ('atelier', 'Ателие', 30),
  ('parking', 'Паркомясто', 40),
  ('garage', 'Гараж', 50),
  ('other', 'Друго', 60)
ON CONFLICT (code) DO NOTHING;

-- 2) Колона group_id в units
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'units' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE public.units ADD COLUMN group_id UUID REFERENCES public.unit_groups(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 3) Попълване по съществуващо поле type
UPDATE public.units u
SET group_id = g.id
FROM public.unit_groups g
WHERE u.group_id IS NULL AND u.type = g.code;

-- 4) Задължителна група
ALTER TABLE public.units ALTER COLUMN group_id SET NOT NULL;

-- 5) Разширяване на CHECK за type (синхрон с unit_groups.code)
ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_type_check;
ALTER TABLE public.units ADD CONSTRAINT units_type_check CHECK (
  type IN ('apartment', 'garage', 'shop', 'parking', 'atelier', 'other')
);

-- 6) Тригер: type следва кода на групата
CREATE OR REPLACE FUNCTION public.units_set_type_from_group()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT g.code INTO NEW.type FROM public.unit_groups g WHERE g.id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_type_from_group ON public.units;
CREATE TRIGGER trg_units_type_from_group
  BEFORE INSERT OR UPDATE OF group_id ON public.units
  FOR EACH ROW
  EXECUTE PROCEDURE public.units_set_type_from_group();

-- 7) Уникалност по група + номер
DROP INDEX IF EXISTS public.idx_units_type_number;
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_group_number ON public.units (group_id, number);
CREATE INDEX IF NOT EXISTS idx_units_group_id ON public.units (group_id);

-- 8) Такси: разрешени кодове на тип единица
ALTER TABLE public.fees DROP CONSTRAINT IF EXISTS fees_unit_type_check;
ALTER TABLE public.fees ADD CONSTRAINT fees_unit_type_check CHECK (
  unit_type IS NULL OR unit_type IN ('apartment', 'garage', 'shop', 'parking', 'atelier', 'other')
);

-- 9) RLS за unit_groups
ALTER TABLE public.unit_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view unit_groups" ON public.unit_groups;
CREATE POLICY "Anyone can view unit_groups"
  ON public.unit_groups FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Editors can insert unit_groups" ON public.unit_groups;
CREATE POLICY "Editors can insert unit_groups"
  ON public.unit_groups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update unit_groups" ON public.unit_groups;
CREATE POLICY "Editors can update unit_groups"
  ON public.unit_groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete unit_groups" ON public.unit_groups;
CREATE POLICY "Editors can delete unit_groups"
  ON public.unit_groups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

COMMENT ON TABLE public.unit_groups IS 'Номенклатура: групи обекти (апартамент, магазин, …)';
COMMENT ON COLUMN public.units.group_id IS 'FK към unit_groups; type се поддържа от тригер според групата';
