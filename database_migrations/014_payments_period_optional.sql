-- Ръчните плащания (income_id IS NULL) не са вързани към билинг период.
-- Полетата period_* остават за евентуални бъдещи случаи или копие от приход; не са задължителни.
-- Изпълни в Supabase → SQL Editor.

COMMENT ON COLUMN public.payments.period_start IS
  'По избор. Ръчните плащания от „Задължения“ се записват без период (NULL). Може да се ползва при връзка с приход или други потоци.';

COMMENT ON COLUMN public.payments.period_end IS
  'По избор. Виж period_start.';

-- Стари ръчни записи, създадени когато UI е попълвал период от билинг — изчистване към новата семантика.
UPDATE public.payments
SET period_start = NULL, period_end = NULL
WHERE income_id IS NULL
  AND (period_start IS NOT NULL OR period_end IS NOT NULL);
