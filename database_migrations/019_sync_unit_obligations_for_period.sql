-- Синхронизира unit_obligations според period_group_amounts за даден период.
-- Извиква се след запис на суми от UI (Периоди и такси), за да не остават дължими суми 0,
-- ако периодът е създаден след миграция 015 (seed там е еднократен).
-- Изисква: 015 (is_editor_or_admin, unit_obligations).
--
-- Тарифният ред за период се намира по (unit_id, billing_period_id, kind=regular), не по title,
-- за да няма дубликати при преименуване на периода (title се подравнява към текущото име).

CREATE OR REPLACE FUNCTION public.sync_unit_obligations_for_period(p_period_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bp RECORD;
  v_sort BIGINT;
  r_unit RECORD;
  v_amt NUMERIC(12, 2);
  v_obl_id UUID;
  v_ao NUMERIC(12, 2);
  v_ar NUMERIC(12, 2);
  v_paid NUMERIC(12, 2);
  v_new_rem NUMERIC(12, 2);
  v_has_alloc BOOLEAN;
  v_kept_id UUID;
BEGIN
  IF NOT public.is_editor_or_admin() THEN
    RAISE EXCEPTION 'Нямате право да синхронизирате задължения';
  END IF;

  SELECT id, name, date_from INTO v_bp FROM public.billing_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Периодът не съществува';
  END IF;

  v_sort := (EXTRACT(EPOCH FROM v_bp.date_from AT TIME ZONE 'UTC')::bigint * 1000);

  FOR r_unit IN SELECT id, group_id FROM public.units
  LOOP
    v_kept_id := NULL;

    SELECT COALESCE(
      (
        SELECT pga.amount
        FROM public.period_group_amounts pga
        WHERE pga.period_id = p_period_id AND pga.group_id = r_unit.group_id
      ),
      0
    ) INTO v_amt;

    SELECT x.id, x.amount_original, x.amount_remaining
    INTO v_obl_id, v_ao, v_ar
    FROM (
      SELECT o.id, o.amount_original, o.amount_remaining
      FROM public.unit_obligations o
      WHERE o.unit_id = r_unit.id
        AND o.billing_period_id = p_period_id
        AND o.kind = 'regular'
      ORDER BY o.created_at ASC NULLS LAST, o.id
      LIMIT 1
    ) x;

    IF FOUND THEN
      IF v_amt > 0 THEN
        v_paid := v_ao - v_ar;
        v_new_rem := GREATEST(0::numeric, v_amt - v_paid);
        UPDATE public.unit_obligations
        SET
          amount_original = v_amt,
          amount_remaining = LEAST(v_new_rem, v_amt),
          sort_key = v_sort,
          title = v_bp.name
        WHERE id = v_obl_id;
        v_kept_id := v_obl_id;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.payment_allocations pa WHERE pa.unit_obligation_id = v_obl_id
        ) INTO v_has_alloc;

        IF v_has_alloc THEN
          UPDATE public.unit_obligations
          SET
            amount_original = 0,
            amount_remaining = 0,
            sort_key = v_sort,
            title = v_bp.name
          WHERE id = v_obl_id;
          v_kept_id := v_obl_id;
        ELSE
          DELETE FROM public.unit_obligations WHERE id = v_obl_id;
        END IF;
      END IF;
    ELSE
      IF v_amt > 0 THEN
        INSERT INTO public.unit_obligations (
          unit_id,
          billing_period_id,
          kind,
          title,
          amount_original,
          amount_remaining,
          sort_key
        ) VALUES (
          r_unit.id,
          p_period_id,
          'regular',
          v_bp.name,
          v_amt,
          v_amt,
          v_sort
        )
        RETURNING id INTO v_kept_id;
      END IF;
    END IF;

    DELETE FROM public.unit_obligations o
    WHERE o.unit_id = r_unit.id
      AND o.billing_period_id = p_period_id
      AND o.kind = 'regular'
      AND (v_kept_id IS NULL OR o.id <> v_kept_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_allocations pa WHERE pa.unit_obligation_id = o.id
      );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sync_unit_obligations_for_period(UUID) IS
  'Обновява редовете unit_obligations за период според period_group_amounts; запазва погасената част при промяна на тарифата; един тарифен ред по (единица, период), title следва името на периода.';

REVOKE ALL ON FUNCTION public.sync_unit_obligations_for_period(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_unit_obligations_for_period(UUID) TO authenticated;
