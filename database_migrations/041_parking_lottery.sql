-- Томбола за паркоместа (до 2 пъти годишно: round 1 или 2): участници, теглене с приоритет за „нови“ пред „повторно участвали“
-- в сравнение с предходната завършена томбола. Резултатите са видими за всички влезли потребители (вкл. viewers).

CREATE TABLE IF NOT EXISTS public.parking_lotteries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  round SMALLINT NOT NULL DEFAULT 1 CHECK (round IN (1, 2)),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drawn_at TIMESTAMPTZ,
  CONSTRAINT parking_lotteries_year_round_unique UNIQUE (year, round)
);

CREATE INDEX IF NOT EXISTS idx_parking_lotteries_year_round ON public.parking_lotteries (year DESC, round DESC);

CREATE TABLE IF NOT EXISTS public.parking_lottery_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lottery_id UUID NOT NULL REFERENCES public.parking_lotteries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parking_lottery_participants_unique UNIQUE (lottery_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_plp_lottery ON public.parking_lottery_participants (lottery_id);

CREATE TABLE IF NOT EXISTS public.parking_lottery_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lottery_id UUID NOT NULL REFERENCES public.parking_lotteries(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  parking_label TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  sort_order INT NOT NULL,
  is_repeat BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT parking_lottery_results_unique_user UNIQUE (lottery_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS parking_lottery_results_lottery_unit_key
  ON public.parking_lottery_results (lottery_id, unit_id);

CREATE INDEX IF NOT EXISTS idx_plr_lottery ON public.parking_lottery_results (lottery_id);

COMMENT ON TABLE public.parking_lotteries IS 'Томбола за паркоместа (до 2 на година: round 1 или 2).';
COMMENT ON COLUMN public.parking_lotteries.round IS 'Кое теглене за годината: 1 или 2.';
COMMENT ON TABLE public.parking_lottery_participants IS 'Избрани участници преди тегленето (email за показване без join към users).';
COMMENT ON TABLE public.parking_lottery_results IS 'По един ред на паркомясто + печеливш; sort_order за ред; is_repeat = участвал в предходната томбола.';

ALTER TABLE public.parking_lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_lottery_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_lottery_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parking_lotteries_select_logged_in" ON public.parking_lotteries;
CREATE POLICY "parking_lotteries_select_logged_in"
  ON public.parking_lotteries FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "parking_lotteries_insert_editors" ON public.parking_lotteries;
CREATE POLICY "parking_lotteries_insert_editors"
  ON public.parking_lotteries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "parking_lotteries_update_editors" ON public.parking_lotteries;
CREATE POLICY "parking_lotteries_update_editors"
  ON public.parking_lotteries FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "parking_lotteries_delete_editors" ON public.parking_lotteries;
CREATE POLICY "parking_lotteries_delete_editors"
  ON public.parking_lotteries FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "parking_lottery_participants_select_logged_in" ON public.parking_lottery_participants;
CREATE POLICY "parking_lottery_participants_select_logged_in"
  ON public.parking_lottery_participants FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "parking_lottery_participants_insert_editors" ON public.parking_lottery_participants;
CREATE POLICY "parking_lottery_participants_insert_editors"
  ON public.parking_lottery_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "parking_lottery_participants_update_editors" ON public.parking_lottery_participants;
CREATE POLICY "parking_lottery_participants_update_editors"
  ON public.parking_lottery_participants FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "parking_lottery_participants_delete_editors" ON public.parking_lottery_participants;
CREATE POLICY "parking_lottery_participants_delete_editors"
  ON public.parking_lottery_participants FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "parking_lottery_results_select_logged_in" ON public.parking_lottery_results;
CREATE POLICY "parking_lottery_results_select_logged_in"
  ON public.parking_lottery_results FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "parking_lottery_results_insert_editors" ON public.parking_lottery_results;
CREATE POLICY "parking_lottery_results_insert_editors"
  ON public.parking_lottery_results FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "parking_lottery_results_update_editors" ON public.parking_lottery_results;
CREATE POLICY "parking_lottery_results_update_editors"
  ON public.parking_lottery_results FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "parking_lottery_results_delete_editors" ON public.parking_lottery_results;
CREATE POLICY "parking_lottery_results_delete_editors"
  ON public.parking_lottery_results FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parking_lotteries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parking_lottery_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parking_lottery_results TO authenticated;
GRANT ALL ON TABLE public.parking_lotteries TO service_role;
GRANT ALL ON TABLE public.parking_lottery_participants TO service_role;
GRANT ALL ON TABLE public.parking_lottery_results TO service_role;
