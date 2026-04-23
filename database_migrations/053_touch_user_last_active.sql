-- Клиентът не може надеждно да обнови last_active_at чрез UPDATE (RLS).
-- RPC обновява само own реда и само времето на последна активност.

CREATE OR REPLACE FUNCTION public.touch_user_last_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.users
  SET last_active_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_last_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_last_active() TO authenticated;

COMMENT ON FUNCTION public.touch_user_last_active() IS
  'Потребител обновява own last_active_at (без RLS върху целия UPDATE към public.users).';
