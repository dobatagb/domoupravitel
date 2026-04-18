-- Прикачен документ към разход (фактура, разписка) — път в bucket documents.
-- Публичен преглед: политиките за storage позволяват SELECT за bucket documents.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS document_path TEXT,
  ADD COLUMN IF NOT EXISTS document_name TEXT;

COMMENT ON COLUMN public.expenses.document_path IS 'Ключ в Supabase Storage, bucket documents (напр. expenses/<uuid>/file.pdf)';
COMMENT ON COLUMN public.expenses.document_name IS 'Оригинално име на файла за показване в UI';
