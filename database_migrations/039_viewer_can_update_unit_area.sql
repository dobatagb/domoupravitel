-- Собственик (viewer): може да актуализира квадратура (area) по свързан обект, освен контакти и бележки.

CREATE OR REPLACE FUNCTION public.units_enforce_viewer_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'viewer'
  ) THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Като собственик може да редактирате контакти, бележки и квадратура; група, номер и задължения се управляват от домоуправителя.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
