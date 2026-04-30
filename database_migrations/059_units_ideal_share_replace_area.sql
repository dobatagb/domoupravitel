-- Идеални части (% ид. части сграда) вместо квадратура (area).
-- Изпълни в Supabase → SQL Editor след 058.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS building_ideal_share_percent NUMERIC(10, 6) NULL;

COMMENT ON COLUMN public.units.building_ideal_share_percent IS '% ид. части сграда';

ALTER TABLE public.units
  DROP CONSTRAINT IF EXISTS units_building_ideal_share_chk;

ALTER TABLE public.units
  ADD CONSTRAINT units_building_ideal_share_chk
  CHECK (
    building_ideal_share_percent IS NULL
    OR (building_ideal_share_percent > 0 AND building_ideal_share_percent <= 100)
  );

-- Попълване по (unit_groups.code, units.number) — магазини, ателиета, апартаменти от регистъра.
UPDATE public.units u
SET building_ideal_share_percent = m.pct
FROM (
  VALUES
    ('shop', '1', 1.952::numeric),
    ('shop', '2', 1.933),
    ('shop', '3', 1.952),
    ('shop', '4', 6.850),
    ('atelier', '1', 1.277),
    ('atelier', '2', 1.105),
    ('atelier', '3', 1.105),
    ('atelier', '4', 1.105),
    ('atelier', '5', 1.105),
    ('atelier', '6', 0.952),
    ('apartment', '1', 2.404),
    ('apartment', '2', 1.551),
    ('apartment', '3', 2.039),
    ('apartment', '4', 0.799),
    ('apartment', '5', 1.215),
    ('apartment', '6', 1.157),
    ('apartment', '7', 1.927),
    ('apartment', '8', 1.313),
    ('apartment', '9', 1.911),
    ('apartment', '10', 2.088),
    ('apartment', '11', 1.385),
    ('apartment', '12', 1.434),
    ('apartment', '13', 1.162),
    ('apartment', '14', 1.241),
    ('apartment', '15', 1.191),
    ('apartment', '16', 1.971),
    ('apartment', '17', 1.359),
    ('apartment', '18', 1.955),
    ('apartment', '19', 2.056),
    ('apartment', '20', 1.382),
    ('apartment', '21', 1.431),
    ('apartment', '22', 1.165),
    ('apartment', '23', 1.244),
    ('apartment', '24', 1.193),
    ('apartment', '25', 1.970),
    ('apartment', '26', 1.343),
    ('apartment', '27', 1.955),
    ('apartment', '28', 2.059),
    ('apartment', '29', 1.364),
    ('apartment', '30', 1.433),
    ('apartment', '31', 1.164),
    ('apartment', '32', 1.208),
    ('apartment', '33', 1.158),
    ('apartment', '34', 1.912),
    ('apartment', '35', 1.303),
    ('apartment', '36', 1.898),
    ('apartment', '37', 2.034),
    ('apartment', '38', 1.349),
    ('apartment', '39', 1.416),
    ('apartment', '40', 1.149),
    ('apartment', '41', 1.548),
    ('apartment', '42', 2.638),
    ('apartment', '43', 1.663),
    ('apartment', '44', 1.004),
    ('apartment', '45', 1.642)
) AS m(group_code, num, pct)
JOIN public.unit_groups g ON g.code = m.group_code
WHERE u.group_id = g.id
  AND u.number = m.num;

ALTER TABLE public.units DROP COLUMN IF EXISTS area;

-- Viewer: не променя идеални части (като счетоводни данни от регистър).
CREATE OR REPLACE FUNCTION public.units_enforce_viewer_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'viewer'
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.building_ideal_share_percent IS DISTINCT FROM OLD.building_ideal_share_percent
    THEN
      RAISE EXCEPTION 'Като собственик може да редактирате само контактите и бележките за вашите обекти.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
