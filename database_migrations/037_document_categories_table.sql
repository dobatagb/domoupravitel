-- Справъчник за тип документ + FK от documents. Миграция от doc_category (TEXT) към document_category_id.

CREATE TABLE IF NOT EXISTS public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.document_categories IS 'Типове документи (показвано име в UI); code е стабилен ключ.';

INSERT INTO public.document_categories (code, name, sort_order) VALUES
  ('meetings', 'Събрания', 1),
  ('administrative', 'Административни', 2),
  ('other', 'Други', 3)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_category_id UUID REFERENCES public.document_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_document_category_id ON public.documents(document_category_id);

DO $migrate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'doc_category'
  ) THEN
    UPDATE public.documents d
    SET document_category_id = c.id
    FROM public.document_categories c
    WHERE d.doc_category IS NOT NULL
      AND d.doc_category = c.code
      AND d.document_category_id IS NULL;
    ALTER TABLE public.documents DROP COLUMN doc_category;
  END IF;
END
$migrate$;

ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_categories_select_authenticated" ON public.document_categories;
CREATE POLICY "document_categories_select_authenticated"
  ON public.document_categories FOR SELECT
  TO authenticated
  USING (true);
