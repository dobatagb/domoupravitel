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
-- 1. НОМЕНКЛАТУРА: ГРУПИ ОБЕКТИ (unit_groups)
-- ============================================
CREATE TABLE IF NOT EXISTS unit_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  list_label_short TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO unit_groups (code, name, list_label_short) VALUES
  ('apartment', 'Апартамент', 'Ап.'),
  ('shop', 'Магазин', 'Маг.'),
  ('atelier', 'Ателие', 'Ат.'),
  ('parking', 'Паркомясто', 'Парк.'),
  ('garage', 'Гараж', 'Гар.'),
  ('other', 'Друго', 'Др.')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 1.5 ПЕРИОДИ И ТАКСИ ПО ГРУПА ЗА ПЕРИОД
-- ============================================
CREATE TABLE IF NOT EXISTS billing_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT billing_periods_dates_ok CHECK (date_from <= date_to)
);

CREATE INDEX IF NOT EXISTS idx_billing_periods_dates ON billing_periods (date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_billing_periods_sort ON billing_periods (sort_order);

CREATE TABLE IF NOT EXISTS period_group_amounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES unit_groups(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT period_group_amounts_unique UNIQUE (period_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_period_group_amounts_period ON period_group_amounts (period_id);
CREATE INDEX IF NOT EXISTS idx_period_group_amounts_group ON period_group_amounts (group_id);

-- ============================================
-- 2. ТАБЛИЦА ЗА ЕДИНИЦИ (units)
-- ============================================
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES unit_groups(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  number TEXT NOT NULL,
  area DECIMAL(10, 2) NOT NULL CHECK (area > 0),
  
  -- Собственик
  owner_name TEXT NOT NULL,
  owner_email TEXT,
  owner_phone TEXT,
  
  -- Наемател (опционално)
  tenant_name TEXT,
  tenant_email TEXT,
  tenant_phone TEXT,
  
  -- Метаданни
  notes TEXT,
  -- Пренесен дълг (лв): стари задължения извън период × група; редактира се ръчно.
  opening_balance DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.units_set_type_from_group()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT g.code INTO NEW.type FROM public.unit_groups g WHERE g.id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_type_from_group ON public.units;
CREATE TRIGGER trg_units_type_from_group
  BEFORE INSERT OR UPDATE OF group_id ON public.units
  FOR EACH ROW
  EXECUTE PROCEDURE public.units_set_type_from_group();

-- Индекси за единици
CREATE INDEX IF NOT EXISTS idx_units_type ON units(type);
CREATE INDEX IF NOT EXISTS idx_units_group_id ON units(group_id);
CREATE INDEX IF NOT EXISTS idx_units_number ON units(number);

-- Уникалност на номер в рамките на група
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_group_number ON units(group_id, number);

-- ============================================
-- 3. ТАБЛИЦА ЗА ПРИХОДИ (income)
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
-- 4. ТАБЛИЦА ЗА РАЗХОДИ (expenses)
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
-- 5. ТАБЛИЦА ЗА РАЗПРЕДЕЛЕНИЕ НА РАЗХОДИ (expense_distributions)
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
-- 6. ТАБЛИЦА ЗА ПЛАЩАНИЯ (payments)
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  income_id UUID REFERENCES income(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  payment_date DATE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'overdue')) DEFAULT 'pending',
  notes TEXT,
  period_start DATE,
  period_end DATE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_unit ON payments(unit_id);
CREATE INDEX IF NOT EXISTS idx_payments_income ON payments(income_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(period_start, period_end);

-- ============================================
-- 7. ТАБЛИЦА ЗА ТАКСИ (fees) - дефиниране на такси
-- ============================================
CREATE TABLE IF NOT EXISTS fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('entry_fee', 'parking_fee', 'shop_fee')),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  unit_group_id UUID REFERENCES unit_groups(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fees_type ON fees(type);
CREATE INDEX IF NOT EXISTS idx_fees_unit_group ON fees(unit_group_id);
CREATE INDEX IF NOT EXISTS idx_fees_active ON fees(is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_unique_active_type_group
  ON fees(type, unit_group_id)
  WHERE is_active = true AND unit_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_unique_active_type_all
  ON fees(type)
  WHERE is_active = true AND unit_group_id IS NULL;

-- ============================================
-- 8. ТАБЛИЦА ЗА ДОКУМЕНТИ (documents)
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
-- 9. ROW LEVEL SECURITY (RLS) ПОЛИТИКИ
-- ============================================

-- Unit groups (номенклатура)
ALTER TABLE unit_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view unit_groups" ON unit_groups;
CREATE POLICY "Anyone can view unit_groups"
  ON unit_groups FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Editors can insert unit_groups" ON unit_groups;
CREATE POLICY "Editors can insert unit_groups"
  ON unit_groups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update unit_groups" ON unit_groups;
CREATE POLICY "Editors can update unit_groups"
  ON unit_groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete unit_groups" ON unit_groups;
CREATE POLICY "Editors can delete unit_groups"
  ON unit_groups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

-- Billing periods
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view billing_periods" ON billing_periods;
CREATE POLICY "Anyone can view billing_periods"
  ON billing_periods FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Editors can insert billing_periods" ON billing_periods;
CREATE POLICY "Editors can insert billing_periods"
  ON billing_periods FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update billing_periods" ON billing_periods;
CREATE POLICY "Editors can update billing_periods"
  ON billing_periods FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete billing_periods" ON billing_periods;
CREATE POLICY "Editors can delete billing_periods"
  ON billing_periods FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

-- Period × group amounts
ALTER TABLE period_group_amounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view period_group_amounts" ON period_group_amounts;
CREATE POLICY "Anyone can view period_group_amounts"
  ON period_group_amounts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Editors can insert period_group_amounts" ON period_group_amounts;
CREATE POLICY "Editors can insert period_group_amounts"
  ON period_group_amounts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can update period_group_amounts" ON period_group_amounts;
CREATE POLICY "Editors can update period_group_amounts"
  ON period_group_amounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "Editors can delete period_group_amounts" ON period_group_amounts;
CREATE POLICY "Editors can delete period_group_amounts"
  ON period_group_amounts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
    )
  );

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
DROP POLICY IF EXISTS "Editors can manage payments" ON payments;
CREATE POLICY "Editors can manage payments"
  ON payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'editor')
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
-- 10. ФУНКЦИИ ЗА АВТОМАТИЧНО ГЕНЕРИРАНЕ
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
-- 11. ТРИГЕРИ
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
-- 12. ГОТОВО ЗА ИЗПОЛНЕНИЕ
-- ============================================

-- Скриптът е готов за изпълнение от нулата
-- Всички таблици, индекси, политики и функции са създадени
-- Storage bucket 'documents' ще бъде създаден автоматично

