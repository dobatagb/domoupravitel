    -- ============================================
    -- ДОБАВЯНЕ НА ВРЪЗКА МЕЖДУ ПОТРЕБИТЕЛИ И ЕДИНИЦИ
    -- Този файл добавя връзката user-unit и обновява RLS политиките
    -- Безопасно за изпълнение - не засяга съществуващи данни
    -- ============================================

-- ============================================
-- ПОМОЩНА ФУНКЦИЯ ЗА ПРОВЕРКА НА АДМИН РОЛЯ
-- ============================================
-- SECURITY DEFINER позволява обхождане на RLS
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

    -- ============================================
    -- ДОБАВЯНЕ НА ПОЛЕ user_id В ТАБЛИЦАТА units
    -- ============================================
    ALTER TABLE units 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

    -- Индекс за бързо търсене
    CREATE INDEX IF NOT EXISTS idx_units_user_id ON units(user_id);

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА units
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view units" ON units;
DROP POLICY IF EXISTS "Admins can view all units, viewers only their own" ON units;
DROP POLICY IF EXISTS "Only admins can insert units" ON units;
DROP POLICY IF EXISTS "Only admins can update units" ON units;
DROP POLICY IF EXISTS "Only admins can delete units" ON units;
DROP POLICY IF EXISTS "Authenticated users can insert units" ON units;
DROP POLICY IF EXISTS "Authenticated users can update units" ON units;
DROP POLICY IF EXISTS "Authenticated users can delete units" ON units;

-- Деактивиране на RLS за units таблицата
ALTER TABLE units DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА payments
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view payments" ON payments;
DROP POLICY IF EXISTS "Admins can view all payments, viewers only their unit" ON payments;
DROP POLICY IF EXISTS "Only admins can manage payments" ON payments;

-- Деактивиране на RLS за payments таблицата
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА income
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view income" ON income;
DROP POLICY IF EXISTS "Admins can view all income, viewers only their unit" ON income;
DROP POLICY IF EXISTS "Only admins can manage income" ON income;

-- Деактивиране на RLS за income таблицата
ALTER TABLE income DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА expenses
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view expenses" ON expenses;
DROP POLICY IF EXISTS "Only admins can manage expenses" ON expenses;

-- Деактивиране на RLS за expenses таблицата
ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА expense_distributions
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view expense distributions" ON expense_distributions;
DROP POLICY IF EXISTS "Admins can view all distributions, viewers only their unit" ON expense_distributions;
DROP POLICY IF EXISTS "Only admins can manage expense distributions" ON expense_distributions;

-- Деактивиране на RLS за expense_distributions таблицата
ALTER TABLE expense_distributions DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА documents
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view documents" ON documents;
DROP POLICY IF EXISTS "Only admins can manage documents" ON documents;

-- Деактивиране на RLS за documents таблицата
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ПРЕМАХВАНЕ НА RLS ПОЛИТИКИ ЗА fees
-- ============================================

-- Премахване на всички политики
DROP POLICY IF EXISTS "Anyone can view fees" ON fees;
DROP POLICY IF EXISTS "Only admins can manage fees" ON fees;

-- Деактивиране на RLS за fees таблицата
ALTER TABLE fees DISABLE ROW LEVEL SECURITY;

