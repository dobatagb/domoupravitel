-- Гарантира RLS върху таблиците за томболата (ако линтерът или ръчни промени са го изключили).

ALTER TABLE IF EXISTS public.parking_lotteries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parking_lottery_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.parking_lottery_results ENABLE ROW LEVEL SECURITY;
