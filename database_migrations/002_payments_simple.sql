-- Плащания без задължителен ред в income; период и дата на плащане на самото плащане.
-- Изпълни в Supabase → SQL Editor (или supabase db push).

ALTER TABLE payments
  ALTER COLUMN income_id DROP NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE;

CREATE INDEX IF NOT EXISTS idx_payments_period ON payments (period_start, period_end);

COMMENT ON COLUMN payments.income_id IS 'NULL = ръчно плащане без приход; иначе връзка към income';
COMMENT ON COLUMN payments.period_start IS 'Период от (за регистрирано плащане)';
COMMENT ON COLUMN payments.period_end IS 'Период до';
