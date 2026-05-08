-- Премахване на роля „editor“: съществуващи записи → admin; само admin | viewer.
-- Обновява помощните функции за RPC/тригери (is_editor_or_admin → като is_admin).

BEGIN;

UPDATE public.users SET role = 'admin' WHERE role = 'editor';

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin IS 'TRUE ако текущият потребител е администратор (public.users.role = admin).';

CREATE OR REPLACE FUNCTION public.is_editor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

COMMENT ON FUNCTION public.is_editor_or_admin IS 'Legacy име: същото като is_admin() след премахване на роля editor.';

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

COMMIT;
