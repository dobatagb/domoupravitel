-- Поведение на групи от базата (без хардкод в приложението) + fees.unit_group_id.
-- Изпълни в Supabase → SQL Editor след 003.

-- 1) Семантика за UI/валидация (редактира се от „Номенклатури“)
ALTER TABLE public.unit_groups
  ADD COLUMN IF NOT EXISTS has_floor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_link_to_parent_unit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_be_link_target BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_owner_account_signup BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS list_label_short TEXT;

COMMENT ON COLUMN public.unit_groups.has_floor IS 'Показва поле етаж при редакция на единица';
COMMENT ON COLUMN public.unit_groups.can_link_to_parent_unit IS 'Може да се избере свързана „родителска“ единица';
COMMENT ON COLUMN public.unit_groups.can_be_link_target IS 'Появява се в списъка за свързване (напр. апартаменти)';
COMMENT ON COLUMN public.unit_groups.allow_owner_account_signup IS 'Опция за създаване на потребител при нова единица';
COMMENT ON COLUMN public.unit_groups.list_label_short IS 'Кратък етикет в таблици; NULL = производно от име';

UPDATE public.unit_groups g SET
  has_floor = (g.code = 'apartment'),
  can_link_to_parent_unit = (g.code IN ('parking', 'garage')),
  can_be_link_target = (g.code = 'apartment'),
  allow_owner_account_signup = (g.code = 'apartment'),
  list_label_short = CASE g.code
    WHEN 'apartment' THEN 'Ап.'
    WHEN 'shop' THEN 'Маг.'
    WHEN 'atelier' THEN 'Ат.'
    WHEN 'parking' THEN 'Парк.'
    WHEN 'garage' THEN 'Гар.'
    WHEN 'other' THEN 'Др.'
    ELSE NULL
  END;

-- 2) units.type — без фиксиран списък кодове; стойността идва от групата (тригер)
ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_type_check;

-- 3) fees: FK към unit_groups вместо текстов код
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS unit_group_id UUID REFERENCES public.unit_groups(id) ON DELETE SET NULL;

UPDATE public.fees f
SET unit_group_id = g.id
FROM public.unit_groups g
WHERE f.unit_group_id IS NULL AND f.unit_type IS NOT NULL AND f.unit_type = g.code;

DROP INDEX IF EXISTS public.idx_fees_unique_active;
DROP INDEX IF EXISTS public.idx_fees_unit_type;

ALTER TABLE public.fees DROP CONSTRAINT IF EXISTS fees_unit_type_check;
ALTER TABLE public.fees DROP COLUMN IF EXISTS unit_type;

CREATE INDEX IF NOT EXISTS idx_fees_unit_group ON public.fees(unit_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_unique_active_type_group
  ON public.fees (type, unit_group_id)
  WHERE is_active = true AND unit_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_unique_active_type_all
  ON public.fees (type)
  WHERE is_active = true AND unit_group_id IS NULL;
