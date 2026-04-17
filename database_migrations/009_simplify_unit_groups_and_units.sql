-- Опростяване: суми по групи са в period_group_amounts; премахват се колони на ниво група (ред, активност, тарифа, флагове) и етаж/връзка между единици.
-- Изпълни в Supabase → SQL Editor след 007/008.

DROP INDEX IF EXISTS public.idx_units_linked;

ALTER TABLE public.units
  DROP COLUMN IF EXISTS floor,
  DROP COLUMN IF EXISTS linked_unit_id;

ALTER TABLE public.unit_groups
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS default_monthly_fee,
  DROP COLUMN IF EXISTS has_floor,
  DROP COLUMN IF EXISTS can_link_to_parent_unit,
  DROP COLUMN IF EXISTS can_be_link_target,
  DROP COLUMN IF EXISTS allow_owner_account_signup;

COMMENT ON TABLE public.unit_groups IS 'Номенклатура: групи обекти (код, име, кратък етикет)';
