-- Не задължителна категория на документ (Събрания / Административни / Други).

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS doc_category TEXT
  CHECK (doc_category IS NULL OR doc_category IN ('meetings', 'administrative', 'other'));

COMMENT ON COLUMN public.documents.doc_category IS 'Категория: meetings=Събрания, administrative=Административни, other=Други; NULL = без тип';
