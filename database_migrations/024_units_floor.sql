-- Етаж / местоположение на обекта (опционално).
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS floor TEXT;

COMMENT ON COLUMN public.units.floor IS 'Етаж или описание: 2, партер, сутерен и т.н.';
