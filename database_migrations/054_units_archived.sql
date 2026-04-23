-- Архивиран обект се крие от падащи избори (задължения и др.); пак е видим в «Обекти» при показ на архив.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.units.archived IS 'true = архив; не участва в нови задължения/плащания чрез списъци.';

CREATE INDEX IF NOT EXISTS idx_units_active_by_archived ON public.units (archived) WHERE (archived = false);
