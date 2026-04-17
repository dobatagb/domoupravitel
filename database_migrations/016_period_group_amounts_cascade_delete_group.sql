-- При изтриване на група от unit_groups да се изтриват и сумите ѝ в period_group_amounts.
-- Изпълни в Supabase → SQL Editor.

ALTER TABLE public.period_group_amounts
  DROP CONSTRAINT IF EXISTS period_group_amounts_group_id_fkey;

ALTER TABLE public.period_group_amounts
  ADD CONSTRAINT period_group_amounts_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.unit_groups(id) ON DELETE CASCADE;
