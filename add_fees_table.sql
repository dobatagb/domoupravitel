-- ============================================
-- ДОБАВЯНЕ НА ТАБЛИЦА ЗА ТАКСИ (fees)
-- Този файл добавя таблицата за управление на такси
-- Безопасно за изпълнение - не засяга съществуващи таблици
-- ============================================

-- ============================================
-- ТАБЛИЦА ЗА ТАКСИ (fees) - дефиниране на такси
-- ============================================
CREATE TABLE IF NOT EXISTS fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('entry_fee', 'parking_fee', 'shop_fee')),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  unit_type TEXT CHECK (unit_type IN ('apartment', 'garage', 'shop', 'parking')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекси за такси
CREATE INDEX IF NOT EXISTS idx_fees_type ON fees(type);
CREATE INDEX IF NOT EXISTS idx_fees_unit_type ON fees(unit_type);
CREATE INDEX IF NOT EXISTS idx_fees_active ON fees(is_active);

-- Частичен уникален индекс: един активен тип такса за един тип единица
CREATE UNIQUE INDEX IF NOT EXISTS idx_fees_unique_active 
ON fees(type, unit_type) 
WHERE is_active = true;

-- ============================================
-- ROW LEVEL SECURITY (RLS) ПОЛИТИКИ
-- ============================================

-- Активиране на RLS за fees
ALTER TABLE fees ENABLE ROW LEVEL SECURITY;

-- Политика за преглед - всички могат да виждат таксите
DROP POLICY IF EXISTS "Anyone can view fees" ON fees;
CREATE POLICY "Anyone can view fees"
  ON fees FOR SELECT
  USING (true);

-- Политика за управление - само администраторите могат да управляват таксите
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

-- ============================================
-- ТРИГЕР ЗА АВТОМАТИЧНО ОБНОВЯВАНЕ НА updated_at
-- ============================================

-- Функцията вече съществува в database_v2.sql, но я добавяме и тук за сигурност
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Тригер за автоматично обновяване на updated_at при промяна
DROP TRIGGER IF EXISTS update_fees_updated_at ON fees;
CREATE TRIGGER update_fees_updated_at
  BEFORE UPDATE ON fees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

