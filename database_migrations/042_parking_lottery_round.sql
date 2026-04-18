-- Ако вече е изпълнена стара 041 с UNIQUE(year) без round — надграждане към 2 томболи годишно.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parking_lotteries_year_unique'
    AND conrelid = 'public.parking_lotteries'::regclass
  ) THEN
    ALTER TABLE public.parking_lotteries DROP CONSTRAINT parking_lotteries_year_unique;
  END IF;
END $$;

ALTER TABLE public.parking_lotteries
  ADD COLUMN IF NOT EXISTS round SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.parking_lotteries
  DROP CONSTRAINT IF EXISTS parking_lotteries_round_check;

ALTER TABLE public.parking_lotteries
  ADD CONSTRAINT parking_lotteries_round_check CHECK (round IN (1, 2));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parking_lotteries_year_round_unique'
    AND conrelid = 'public.parking_lotteries'::regclass
  ) THEN
    ALTER TABLE public.parking_lotteries
      ADD CONSTRAINT parking_lotteries_year_round_unique UNIQUE (year, round);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parking_lotteries_year_round ON public.parking_lotteries (year DESC, round DESC);

COMMENT ON COLUMN public.parking_lotteries.round IS 'Кое теглене за годината: 1 или 2.';
