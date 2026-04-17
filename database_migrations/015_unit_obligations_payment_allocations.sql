-- Задължения по обект + приспадане на плащания (извънредни първи, най-стари първо; после редовни, най-стари първо).
-- Контрол: не се допуска плащане над сумата на непогасените задължения.
-- Изпълни в Supabase → SQL Editor след 008 (billing_periods) и 014.

-- ========== колона начин на плащане ==========
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

COMMENT ON COLUMN public.payments.payment_method IS 'Напр. cash, bank_transfer, card — по желание';

-- ========== таблици ==========
CREATE TABLE IF NOT EXISTS public.unit_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  billing_period_id UUID REFERENCES public.billing_periods(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regular', 'extraordinary')),
  title TEXT NOT NULL,
  amount_original NUMERIC(12, 2) NOT NULL CHECK (amount_original >= 0),
  amount_remaining NUMERIC(12, 2) NOT NULL CHECK (amount_remaining >= 0),
  sort_key BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unit_obligations_remaining_lte_original CHECK (amount_remaining <= amount_original)
);

CREATE INDEX IF NOT EXISTS idx_unit_obligations_unit ON public.unit_obligations (unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_obligations_remaining ON public.unit_obligations (unit_id)
  WHERE amount_remaining > 0;

COMMENT ON TABLE public.unit_obligations IS 'Ред задължение за единица; приспадане по priority: extraordinary преди regular, sort_key нарастващо (най-старо първо)';

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  unit_obligation_id UUID NOT NULL REFERENCES public.unit_obligations(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_obligation ON public.payment_allocations (unit_obligation_id);

COMMENT ON TABLE public.payment_allocations IS 'Колко от плащането е приспаднато към кое задължение';

-- ========== помощна: редактор? ==========
CREATE OR REPLACE FUNCTION public.is_editor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
  );
$$;

-- ========== прилагане на сума към задължения (съществуващ ред в payments) ==========
CREATE OR REPLACE FUNCTION public.apply_payment_allocations(
  p_payment_id UUID,
  p_unit_id UUID,
  p_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rem NUMERIC;
  r RECORD;
  v_take NUMERIC;
  v_total NUMERIC;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'apply_payment_allocations: невалидна сума';
  END IF;

  SELECT COALESCE(SUM(amount_remaining), 0) INTO v_total
  FROM public.unit_obligations
  WHERE unit_id = p_unit_id AND amount_remaining > 0;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Няма дължими суми за тази единица';
  END IF;

  IF p_amount > v_total + 0.005 THEN
    RAISE EXCEPTION 'Сумата надвишава дължимото. Максимално дължима сума: % €.', ROUND(v_total, 2);
  END IF;

  v_rem := p_amount;

  FOR r IN
    SELECT id, amount_remaining
    FROM public.unit_obligations
    WHERE unit_id = p_unit_id AND amount_remaining > 0
    ORDER BY
      CASE kind WHEN 'extraordinary' THEN 0 ELSE 1 END,
      sort_key ASC,
      created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_rem <= 0;
    v_take := LEAST(r.amount_remaining, v_rem);
    INSERT INTO public.payment_allocations (payment_id, unit_obligation_id, amount)
    VALUES (p_payment_id, r.id, v_take);
    UPDATE public.unit_obligations
    SET amount_remaining = amount_remaining - v_take
    WHERE id = r.id;
    v_rem := v_rem - v_take;
  END LOOP;

  IF v_rem > 0.005 THEN
    RAISE EXCEPTION 'Вътрешна грешка при разпределение (остатък %)', v_rem;
  END IF;
END;
$$;

-- ========== ново плащане ==========
CREATE OR REPLACE FUNCTION public.register_payment(
  p_unit_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да записвате плащания';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Невалидна сума';
  END IF;

  INSERT INTO public.payments (income_id, unit_id, amount, payment_date, status, notes, payment_method)
  VALUES (
    NULL,
    p_unit_id,
    p_amount,
    p_payment_date,
    'paid',
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    NULLIF(btrim(COALESCE(p_payment_method, '')), '')
  )
  RETURNING id INTO v_payment_id;

  PERFORM public.apply_payment_allocations(v_payment_id, p_unit_id, p_amount);

  RETURN v_payment_id;
END;
$$;

-- ========== изтриване на плащане + възстановяване на задължения ==========
CREATE OR REPLACE FUNCTION public.delete_payment_with_restore(p_payment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да изтривате плащания';
  END IF;

  UPDATE public.unit_obligations uo
  SET amount_remaining = uo.amount_remaining + pa.amount
  FROM public.payment_allocations pa
  WHERE pa.unit_obligation_id = uo.id
    AND pa.payment_id = p_payment_id;

  DELETE FROM public.payments WHERE id = p_payment_id;
END;
$$;

-- ========== сума дължимо по единица (за UI) ==========
CREATE OR REPLACE FUNCTION public.unit_total_due(p_unit_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_editor_or_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.user_unit_links l
       WHERE l.user_id = auth.uid() AND l.unit_id = p_unit_id
     ) THEN
    RAISE EXCEPTION 'Нямате достъп до тази единица';
  END IF;
  RETURN (
    SELECT COALESCE(SUM(amount_remaining), 0)::NUMERIC(12, 2)
    FROM public.unit_obligations
    WHERE unit_id = p_unit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_payment_allocations(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_payment(UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment_with_restore(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unit_total_due(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_editor_or_admin() TO authenticated;

-- ========== seed: пренесен дълг + редове от period_group_amounts ==========
INSERT INTO public.unit_obligations (unit_id, billing_period_id, kind, title, amount_original, amount_remaining, sort_key)
SELECT u.id, NULL, 'regular', 'Пренесен дълг', u.opening_balance, u.opening_balance, -2000000000::bigint
FROM public.units u
WHERE u.opening_balance > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.unit_obligations o
    WHERE o.unit_id = u.id AND o.billing_period_id IS NULL AND o.title = 'Пренесен дълг'
  );

INSERT INTO public.unit_obligations (unit_id, billing_period_id, kind, title, amount_original, amount_remaining, sort_key)
SELECT
  u.id,
  bp.id,
  'regular',
  bp.name,
  pga.amount,
  pga.amount,
  (EXTRACT(EPOCH FROM bp.date_from AT TIME ZONE 'UTC')::bigint * 1000)
FROM public.billing_periods bp
JOIN public.period_group_amounts pga ON pga.period_id = bp.id
JOIN public.units u ON u.group_id = pga.group_id
WHERE pga.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.unit_obligations o
    WHERE o.unit_id = u.id AND o.billing_period_id = bp.id AND o.title = bp.name
  );

-- ========== backfill: съществуващи ръчни плащания без разпределение ==========
DO $$
DECLARE
  r RECORD;
  v_has_alloc BOOLEAN;
  v_pay_count INT;
  v_has_obl BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.payment_allocations LIMIT 1) INTO v_has_alloc;
  SELECT count(*)::int FROM public.payments WHERE income_id IS NULL INTO v_pay_count;
  SELECT EXISTS (SELECT 1 FROM public.unit_obligations LIMIT 1) INTO v_has_obl;

  IF v_has_alloc OR v_pay_count = 0 OR NOT v_has_obl THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id, unit_id, amount
    FROM public.payments
    WHERE income_id IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    BEGIN
      PERFORM public.apply_payment_allocations(r.id, r.unit_id, r.amount);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill: плащане % не е разпределено: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ========== RLS ==========
ALTER TABLE public.unit_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "unit_obligations_select_scope" ON public.unit_obligations;
CREATE POLICY "unit_obligations_select_scope"
  ON public.unit_obligations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
    OR EXISTS (
      SELECT 1 FROM public.user_unit_links l
      WHERE l.user_id = auth.uid() AND l.unit_id = unit_obligations.unit_id
    )
  );

DROP POLICY IF EXISTS "unit_obligations_editors_all" ON public.unit_obligations;
CREATE POLICY "unit_obligations_editors_all"
  ON public.unit_obligations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );

DROP POLICY IF EXISTS "payment_allocations_select_scope" ON public.payment_allocations;
CREATE POLICY "payment_allocations_select_scope"
  ON public.payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_allocations.payment_id
        AND (
          EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
          OR EXISTS (
            SELECT 1 FROM public.user_unit_links l
            WHERE l.user_id = auth.uid() AND l.unit_id = p.unit_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "payment_allocations_editors_all" ON public.payment_allocations;
CREATE POLICY "payment_allocations_editors_all"
  ON public.payment_allocations FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor'))
  );
