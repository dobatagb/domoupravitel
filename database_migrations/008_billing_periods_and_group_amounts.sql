-- Периоди на таксуване + сума по група за период (един ред = period × group).
-- Изпълни в Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.billing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT billing_periods_dates_ok CHECK (date_from <= date_to)
);

CREATE INDEX IF NOT EXISTS idx_billing_periods_dates ON public.billing_periods (date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_billing_periods_sort ON public.billing_periods (sort_order);

CREATE TABLE IF NOT EXISTS public.period_group_amounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.billing_periods(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.unit_groups(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT period_group_amounts_unique UNIQUE (period_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_period_group_amounts_period ON public.period_group_amounts (period_id);
CREATE INDEX IF NOT EXISTS idx_period_group_amounts_group ON public.period_group_amounts (group_id);

COMMENT ON TABLE public.billing_periods IS 'Именувани прозорци за таксуване (напр. полугодие)';
COMMENT ON TABLE public.period_group_amounts IS 'Задължение по група за период: всички единици от групата ползват същата сума за този период';

ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_group_amounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view billing_periods" ON public.billing_periods;
CREATE POLICY "Anyone can view billing_periods"
  ON public.billing_periods FOR SELECT USING (true);

DROP POLICY IF EXISTS "Editors can insert billing_periods" ON public.billing_periods;
CREATE POLICY "Editors can insert billing_periods"
  ON public.billing_periods FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update billing_periods" ON public.billing_periods;
CREATE POLICY "Editors can update billing_periods"
  ON public.billing_periods FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete billing_periods" ON public.billing_periods;
CREATE POLICY "Editors can delete billing_periods"
  ON public.billing_periods FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Anyone can view period_group_amounts" ON public.period_group_amounts;
CREATE POLICY "Anyone can view period_group_amounts"
  ON public.period_group_amounts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Editors can insert period_group_amounts" ON public.period_group_amounts;
CREATE POLICY "Editors can insert period_group_amounts"
  ON public.period_group_amounts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update period_group_amounts" ON public.period_group_amounts;
CREATE POLICY "Editors can update period_group_amounts"
  ON public.period_group_amounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete period_group_amounts" ON public.period_group_amounts;
CREATE POLICY "Editors can delete period_group_amounts"
  ON public.period_group_amounts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role IN ('admin', 'editor')
    )
  );
