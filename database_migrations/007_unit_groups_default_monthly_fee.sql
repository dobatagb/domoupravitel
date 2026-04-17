-- Месечна тарифа по група обект (един запис = една промяна за целия тип).
-- Изпълни в Supabase → SQL Editor.

ALTER TABLE public.unit_groups
  ADD COLUMN IF NOT EXISTS default_monthly_fee NUMERIC(12, 2);

COMMENT ON COLUMN public.unit_groups.default_monthly_fee IS 'Подразбираща се месечна сума (лв) за обекти от тази група; NULL = не е зададена';
