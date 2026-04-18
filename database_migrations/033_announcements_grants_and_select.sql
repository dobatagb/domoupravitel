-- Поправка: без GRANT PostgREST може да не връща редове за anon/authenticated.
-- Политика за SELECT с auth.uid() е по-надеждна от USING (true) при някои конфигурации.

GRANT SELECT ON TABLE public.announcements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;

DROP POLICY IF EXISTS "announcements_select_authenticated" ON public.announcements;
DROP POLICY IF EXISTS "announcements_select_logged_in" ON public.announcements;

-- Без TO — важи за всички роли; само сесии с валиден JWT (auth.uid()) виждат редове.
CREATE POLICY "announcements_select_logged_in"
  ON public.announcements FOR SELECT
  USING (auth.uid() IS NOT NULL);
