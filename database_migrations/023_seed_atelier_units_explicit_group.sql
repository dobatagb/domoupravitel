-- Ателиета 1–6 с фиксиран group_id (ред от unit_groups за Ателие / code atelier).
-- Идемпотентно: ON CONFLICT (group_id, number) DO UPDATE.
-- Провери, че UUID-то е id на вашата група „Ателие“ в public.unit_groups (колона id).
-- Изпълни в Supabase → SQL Editor.

INSERT INTO public.units (group_id, number, area, owner_name, owner_phone, owner_email, opening_balance, notes)
VALUES
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '1', 35::numeric, 'Недялка Пулевска', '0884701025', 'mar38@abv.bg', 0, NULL),
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '2', 35::numeric, 'Рамадан Алиев', '0887460580', 'ramadanaliev@gmail.com', 0, NULL),
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '3', 35::numeric, 'Живка Куртева', '0889112346', NULL, 0, NULL),
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '4', 35::numeric, 'Марко Солинков', '0885716626', 'm.solinkov@gmail.com', 0, NULL),
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '5', 35::numeric, 'Ивелина Налбантова', '0896705293', 'ivadi82@abv.bg', 0, NULL),
  ('4c9f005c-cc1f-4d47-9ec6-dbed6b13c39e'::uuid, '6', 35::numeric, 'Славея Младенова', '0877177749', 'slavei4eto91@abv.bg', 0, NULL)
ON CONFLICT (group_id, number) DO UPDATE SET
  owner_name = EXCLUDED.owner_name,
  owner_phone = EXCLUDED.owner_phone,
  owner_email = EXCLUDED.owner_email,
  area = EXCLUDED.area,
  notes = EXCLUDED.notes,
  updated_at = NOW();
