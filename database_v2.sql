-- ============================================
-- ОБНОВЕНА СТРУКТУРА НА БАЗА ДАННИ
-- Версия 2.0 - Разширена система
-- ============================================

-- ============================================
-- 0. ТАБЛИЦА ЗА ПОТРЕБИТЕЛИ (users) - ако не съществува
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Функция за автоматично създаване на потребител при регистрация
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, 'viewer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger за автоматично създаване на потребител
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS политики за users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all users" ON users;
CREATE POLICY "Users can view all users"
  ON users FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert their own record" ON users;
CREATE POLICY "Users can insert their own record"
  ON users FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own role if admin" ON users;
CREATE POLICY "Users can update their own role if admin"
  ON users FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
    OR auth.uid() = id
  );

-- ============================================
-- 0.1. STORAGE BUCKET ЗА ДОКУМЕНТИ
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Политики за Storage
DROP POLICY IF EXISTS "Anyone can view storage documents" ON storage.objects;
CREATE POLICY "Anyone can view storage documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "Only admins and editors can upload documents" ON storage.objects;
CREATE POLICY "Only admins and editors can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Only admins and editors can delete storage documents" ON storage.objects;
CREATE POLICY "Only admins and editors can delete storage documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

-- ============================================
-- 1. ТАБЛИЦА ЗА ЕДИНИЦИ (units)
-- ============================================
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('apartment', 'garage', 'shop', 'parking')),
  number TEXT NOT NULL,
  floor INTEGER, -- само за апартаменти
  area DECIMAL(10, 2) NOT NULL CHECK (area > 0),
  
  -- Собственик
  owner_name TEXT NOT NULL,
  owner_email TEXT,
  owner_phone TEXT,
  
  -- Наемател (опционално)
  tenant_name TEXT,
  tenant_email TEXT,
  tenant_phone TEXT,
  
  -- Свързване (за паркоместа и гаражи - опционално)
  -- Може да се свърже апартамент с гараж или паркоместо
  linked_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  
  -- Метаданни
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекси за единици
CREATE INDEX IF NOT EXISTS idx_units_type ON units(type);
CREATE INDEX IF NOT EXISTS idx_units_number ON units(number);
CREATE INDEX IF NOT EXISTS idx_units_linked ON units(linked_unit_id);

-- Уникалност на номер + тип (еднакви номера могат да са в различни типове)
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_type_number ON units(type, number);

-- ============================================
-- 2. ТАБЛИЦА ЗА ПРИХОДИ (income)
-- ============================================
CREATE TABLE IF NOT EXISTS income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('entry_fee', 'parking_fee', 'other')),
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  date DATE NOT NULL,
  unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  
  -- За входна такса
  period_start DATE, -- начало на период (1 януари или 1 юли)
  period_end DATE,   -- край на период (30 юни или 31 декември)
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_income_type ON income(type);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_unit ON income(unit_id);

-- ============================================
-- 3. ТАБЛИЦА ЗА РАЗХОДИ (expenses)
-- ============================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  date DATE NOT NULL,
  
  -- Метод на разпределение
  distribution_method TEXT NOT NULL CHECK (distribution_method IN ('equal', 'by_area', 'manual')) DEFAULT 'equal',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- ============================================
-- 4. ТАБЛИЦА ЗА РАЗПРЕДЕЛЕНИЕ НА РАЗХОДИ (expense_distributions)
-- ============================================
CREATE TABLE IF NOT EXISTS expense_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(expense_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_exp_dist_expense ON expense_distributions(expense_id);
CREATE INDEX IF NOT EXISTS idx_exp_dist_unit ON expense_distributions(unit_id);

-- ============================================
-- 5. ТАБЛИЦА ЗА ПЛАЩАНИЯ (payments)
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_id UUID NOT NULL REFERENCES income(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'overdue')) DEFAULT 'pending',
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_unit ON payments(unit_id);
CREATE INDEX IF NOT EXISTS idx_payments_income ON payments(income_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- ============================================
-- 5.1. ТАБЛИЦА ЗА ТАКСИ (fees) - дефиниране на такси
-- ============================================
CREATE TABLE IF NOT EXISTS fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('entry_fee', 'parking_fee', 'shop_fee')),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  unit_type TEXT CHECK (unit_type IN ('apartment', 'garage', 'shop', 'parking')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Уникалност: един активен тип такса за един тип единица
  UNIQUE(type, unit_type, is_active) WHERE is_active = true
);

CREATE INDEX IF NOT EXISTS idx_fees_type ON fees(type);
CREATE INDEX IF NOT EXISTS idx_fees_unit_type ON fees(unit_type);
CREATE INDEX IF NOT EXISTS idx_fees_active ON fees(is_active);

-- ============================================
-- 6. ТАБЛИЦА ЗА ДОКУМЕНТИ (documents)
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  description TEXT,
  
  -- Свързване с обекти
  related_type TEXT CHECK (related_type IN ('expense', 'income', 'unit')),
  related_id UUID,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_related ON documents(related_type, related_id);

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS) ПОЛИТИКИ
-- ============================================

-- Units
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view units" ON units;
CREATE POLICY "Anyone can view units"
  ON units FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can insert units" ON units;
CREATE POLICY "Only admins can insert units"
  ON units FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Only admins can update units" ON units;
CREATE POLICY "Only admins can update units"
  ON units FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Only admins can delete units" ON units;
CREATE POLICY "Only admins can delete units"
  ON units FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Income
ALTER TABLE income ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view income" ON income;
CREATE POLICY "Anyone can view income"
  ON income FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage income" ON income;
CREATE POLICY "Only admins can manage income"
  ON income FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view expenses" ON expenses;
CREATE POLICY "Anyone can view expenses"
  ON expenses FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage expenses" ON expenses;
CREATE POLICY "Only admins can manage expenses"
  ON expenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Expense Distributions
ALTER TABLE expense_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view expense distributions" ON expense_distributions;
CREATE POLICY "Anyone can view expense distributions"
  ON expense_distributions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage expense distributions" ON expense_distributions;
CREATE POLICY "Only admins can manage expense distributions"
  ON expense_distributions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Fees
ALTER TABLE fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view fees" ON fees;
CREATE POLICY "Anyone can view fees"
  ON fees FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage fees" ON fees;
CREATE POLICY "Only admins can manage fees"
  ON fees FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view payments" ON payments;
CREATE POLICY "Anyone can view payments"
  ON payments FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage payments" ON payments;
CREATE POLICY "Only admins can manage payments"
  ON payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view documents" ON documents;
CREATE POLICY "Anyone can view documents"
  ON documents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage documents" ON documents;
CREATE POLICY "Only admins can manage documents"
  ON documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- ============================================
-- 8. ФУНКЦИИ ЗА АВТОМАТИЧНО ГЕНЕРИРАНЕ
-- ============================================

-- Функция за автоматично генериране на входна такса
CREATE OR REPLACE FUNCTION generate_entry_fees(
  period_start_date DATE,
  period_end_date DATE
)
RETURNS void AS $$
DECLARE
  unit_record RECORD;
  fee_amount DECIMAL := 8.00;
  new_income_id UUID;
BEGIN
  -- Генериране на входна такса за всички единици
  FOR unit_record IN SELECT id FROM units LOOP
    -- Създаване на приход (входна такса)
    INSERT INTO income (type, amount, description, date, unit_id, period_start, period_end)
    VALUES (
      'entry_fee',
      fee_amount,
      'Входна такса за период ' || TO_CHAR(period_start_date, 'DD.MM.YYYY') || ' - ' || TO_CHAR(period_end_date, 'DD.MM.YYYY'),
      period_start_date,
      unit_record.id,
      period_start_date,
      period_end_date
    )
    RETURNING id INTO new_income_id;
    
    -- Създаване на плащане (чака плащане)
    INSERT INTO payments (income_id, unit_id, amount, status)
    VALUES (new_income_id, unit_record.id, fee_amount, 'pending');
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. ТРИГЕРИ
-- ============================================

-- Trigger за автоматично обновяване на updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 10. ГОТОВО ЗА ИЗПОЛНЕНИЕ
-- ============================================

-- Скриптът е готов за изпълнение от нулата
-- Всички таблици, индекси, политики и функции са създадени
-- Storage bucket 'documents' ще бъде създаден автоматично

