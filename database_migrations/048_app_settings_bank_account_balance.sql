-- Наличност по банкова сметка (отделно от кеш в касата). Показва се на Начало до кеша.
-- Изпълни в Supabase SQL Editor след 017.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS bank_account_balance NUMERIC(20, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.app_settings.bank_account_balance IS
  'Наличност по разплащателна сметка (EUR), ръчно; отделно от cash_opening_balance.';
