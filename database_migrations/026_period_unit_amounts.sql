-- Индивидуална сума по единица за период (начин 2). Ако има ред тук, той замества сумата от period_group_amounts за същата група.
-- Изисква: billing_periods, units, 008/period_group_amounts.
-- CASCADE: при изтриване на период или единица редовете се махат.

CREATE TABLE IF NOT EXISTS public.period_unit_amounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.billing_periods(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT period_unit_amounts_unique UNIQUE (period_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_period_unit_amounts_period ON public.period_unit_amounts (period_id);
CREATE INDEX IF NOT EXISTS idx_period_unit_amounts_unit ON public.period_unit_amounts (unit_id);

COMMENT ON TABLE public.period_unit_amounts IS 'По избор: сума за конкретна единица за период; има предимство пред period_group_amounts за нейната група.';

ALTER TABLE public.period_unit_amounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view period_unit_amounts" ON public.period_unit_amounts;
CREATE POLICY "Anyone can view period_unit_amounts"
  ON public.period_unit_amounts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Editors can insert period_unit_amounts" ON public.period_unit_amounts;
CREATE POLICY "Editors can insert period_unit_amounts"
  ON public.period_unit_amounts FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "Editors can update period_unit_amounts" ON public.period_unit_amounts;
CREATE POLICY "Editors can update period_unit_amounts"
  ON public.period_unit_amounts FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "Editors can delete period_unit_amounts" ON public.period_unit_amounts;
CREATE POLICY "Editors can delete period_unit_amounts"
  ON public.period_unit_amounts FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );
