-- Резултат: по един ред на паркомясто + печеливш (миграция от стара 041 без unit_id).
-- Ако вече е приложена новата 041 с unit_id — само индекси/коментари.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'parking_lottery_results' AND column_name = 'unit_id'
  ) THEN
    PERFORM 1; -- вече нова схема (напр. свежа 041)
  ELSE
    -- Стара схема: rank_order, без паркоместа
    DELETE FROM public.parking_lottery_results;
    UPDATE public.parking_lotteries SET drawn_at = NULL WHERE drawn_at IS NOT NULL;

    ALTER TABLE public.parking_lottery_results DROP CONSTRAINT IF EXISTS parking_lottery_results_unique_rank;
    ALTER TABLE public.parking_lottery_results DROP CONSTRAINT IF EXISTS parking_lottery_results_unique_user;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'parking_lottery_results' AND column_name = 'rank_order'
    ) THEN
      ALTER TABLE public.parking_lottery_results RENAME COLUMN rank_order TO sort_order;
    END IF;

    ALTER TABLE public.parking_lottery_results
      ADD COLUMN unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
      ADD COLUMN parking_label TEXT NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS parking_lottery_results_lottery_unit_key
  ON public.parking_lottery_results (lottery_id, unit_id);

CREATE UNIQUE INDEX IF NOT EXISTS parking_lottery_results_lottery_user_key
  ON public.parking_lottery_results (lottery_id, user_id);

COMMENT ON COLUMN public.parking_lottery_results.unit_id IS 'Паркомясто от units (група parking).';
COMMENT ON COLUMN public.parking_lottery_results.parking_label IS 'Етикет за екрана (група + номер).';
COMMENT ON COLUMN public.parking_lottery_results.sort_order IS 'Ред в списъка; подредбата може да се коригира ръчно.';
