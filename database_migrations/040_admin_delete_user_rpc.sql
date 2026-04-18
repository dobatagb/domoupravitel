-- Изтриване на потребител от auth (и CASCADE към public.users, user_unit_links и др.).
-- Извиква се само от администратор чрез RPC; клиентът не може директно да пипа auth.users.

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Няма активна сесия.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin') THEN
    RAISE EXCEPTION 'Само администратор може да изтрива потребители.';
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Не можете да изтриете собствения си акаунт.';
  END IF;
  DELETE FROM auth.users WHERE id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
