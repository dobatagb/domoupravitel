-- Администратор задава нова парола на друг потребител (без имейл).
-- Хешът е bcrypt, съвместим с GoTrue/Supabase Auth (като при crypt в pgcrypto).
-- Изисква: public.users с роль admin, pgcrypto (стандартно в Supabase).

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_target_user_id uuid, p_new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_pass text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Няма активна сесия.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin') THEN
    RAISE EXCEPTION 'Само администратор може да задава парола.';
  END IF;
  v_pass := trim(p_new_password);
  IF v_pass IS NULL OR length(v_pass) < 6 THEN
    RAISE EXCEPTION 'Паролата трябва да е поне 6 символа.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Потребителят не съществува.';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_set_user_password(uuid, text) IS
  'Администратор задава нова парола в auth.users (без изпращане на имейл).';
