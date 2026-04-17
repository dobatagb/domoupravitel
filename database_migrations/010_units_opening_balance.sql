-- Пренесен дълг по единица (преди или извън модела период × група).
-- Изпълни в Supabase → SQL Editor след 009.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12, 2) NOT NULL DEFAULT 0
  CHECK (opening_balance >= 0);

COMMENT ON COLUMN public.units.opening_balance IS
  'Натрупан дълг по единица (лв), който не идва от period_group_amounts; намалява се ръчно при погасяване.';
