-- Синхронизация: units.opening_balance → ред в unit_obligations „Пренесен дълг“ (без период).
-- Без това полето в обекти не влиза в building_unit_dues / плащания по редове.
-- Изпълни в Supabase SQL Editor след 015.

CREATE OR REPLACE FUNCTION public.sync_unit_opening_balance_obligation(p_unit_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ob NUMERIC(12, 2);
  r RECORD;
  v_paid NUMERIC(12, 2);
  v_new_orig NUMERIC(12, 2);
  v_new_rem NUMERIC(12, 2);
BEGIN
  SELECT COALESCE(u.opening_balance, 0)::NUMERIC(12, 2) INTO v_ob
  FROM public.units u
  WHERE u.id = p_unit_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT o.* INTO r
  FROM public.unit_obligations o
  WHERE o.unit_id = p_unit_id
    AND o.billing_period_id IS NULL
    AND o.title = 'Пренесен дълг'
  ORDER BY o.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_ob > 0 THEN
      INSERT INTO public.unit_obligations (
        unit_id,
        billing_period_id,
        kind,
        title,
        amount_original,
        amount_remaining,
        sort_key
      )
      VALUES (
        p_unit_id,
        NULL,
        'regular',
        'Пренесен дълг',
        v_ob,
        v_ob,
        -2000000000::bigint
      );
    END IF;
    RETURN;
  END IF;

  v_paid := r.amount_original - r.amount_remaining;
  v_new_rem := GREATEST(0::NUMERIC, v_ob - v_paid);
  v_new_orig := v_new_rem + v_paid;

  IF v_paid <= 0 AND v_ob <= 0 THEN
    DELETE FROM public.unit_obligations WHERE id = r.id;
    RETURN;
  END IF;

  UPDATE public.unit_obligations
  SET amount_original = v_new_orig,
      amount_remaining = v_new_rem
  WHERE id = r.id;
END;
$$;

COMMENT ON FUNCTION public.sync_unit_opening_balance_obligation(UUID) IS
  'Поддържа един ред „Пренесен дълг“ според units.opening_balance; запазва вече приспаднатата сума (оригинал − остатък).';

CREATE OR REPLACE FUNCTION public.trg_units_after_opening_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_unit_opening_balance_obligation(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND (NEW.opening_balance IS DISTINCT FROM OLD.opening_balance) THEN
    PERFORM public.sync_unit_opening_balance_obligation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_units_sync_opening_balance ON public.units;
CREATE TRIGGER trg_units_sync_opening_balance
  AFTER INSERT OR UPDATE OF opening_balance ON public.units
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_units_after_opening_balance();

-- Попълване за вече въведени обекти с пренесен дълг, но без ред в unit_obligations
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT u.id
    FROM public.units u
    WHERE COALESCE(u.opening_balance, 0) > 0
  LOOP
    PERFORM public.sync_unit_opening_balance_obligation(r.id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.sync_unit_opening_balance_obligation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_unit_opening_balance_obligation(UUID) TO authenticated;
