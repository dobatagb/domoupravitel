-- Един ред настройки: начална наличност в касата (преди записаните приходи/разходи в приложението).
-- Изпълни в Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cash_opening_balance NUMERIC(20, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.app_settings IS 'Глобални настройки (един ред id=1)';
COMMENT ON COLUMN public.app_settings.cash_opening_balance IS 'Начална наличност в касата (EUR), без превалутиране';

INSERT INTO public.app_settings (id, cash_opening_balance)
VALUES (1, 6500)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_all" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_insert_editors" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_update_editors" ON public.app_settings;
CREATE POLICY "app_settings_select_all"
  ON public.app_settings FOR SELECT
  USING (true);

CREATE POLICY "app_settings_insert_editors"
  ON public.app_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "app_settings_update_editors"
  ON public.app_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'editor')
    )
  );
