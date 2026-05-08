-- Протокол / бележки към събрание (видими за всички; редактира само администратор по RLS на meetings).

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.meetings.notes IS 'Протокол, решения и бележки от събранието.';
