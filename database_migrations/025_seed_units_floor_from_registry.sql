-- Етаж по регистър (Етаж / Обект N / Вид).
-- Съвпада с 018_seed_units_owners: group code + номер на обекта.
-- Паркоместа не са в изходната таблица — floor за тях не се пипа.
-- Изисква 024_units_floor.sql (колона floor).
-- Идемпотентно: повторно изпълнение записва същите стойности.

UPDATE public.units u
SET
  floor = v.floor,
  updated_at = NOW()
FROM (
  VALUES
    -- Магазини
    ('shop', '1', '0'),
    ('shop', '2', '0'),
    ('shop', '3', '0'),
    ('shop', '4', '0'),
    -- Апартаменти
    ('apartment', '1', '1'),
    ('apartment', '2', '1'),
    ('apartment', '3', '1'),
    ('apartment', '4', '1'),
    ('apartment', '5', '1'),
    ('apartment', '6', '1'),
    ('apartment', '7', '1'),
    ('apartment', '8', '1'),
    ('apartment', '9', '1'),
    ('apartment', '10', '2'),
    ('apartment', '11', '2'),
    ('apartment', '12', '2'),
    ('apartment', '13', '2'),
    ('apartment', '14', '2'),
    ('apartment', '15', '2'),
    ('apartment', '16', '2'),
    ('apartment', '17', '2'),
    ('apartment', '18', '2'),
    ('apartment', '19', '3'),
    ('apartment', '20', '3'),
    ('apartment', '21', '3'),
    ('apartment', '22', '3'),
    ('apartment', '23', '3'),
    ('apartment', '24', '3'),
    ('apartment', '25', '3'),
    ('apartment', '26', '3'),
    ('apartment', '27', '3'),
    ('apartment', '28', '4'),
    ('apartment', '29', '4'),
    ('apartment', '30', '4'),
    ('apartment', '31', '4'),
    ('apartment', '32', '4'),
    ('apartment', '33', '4'),
    ('apartment', '34', '4'),
    ('apartment', '35', '4'),
    ('apartment', '36', '4'),
    ('apartment', '37', '5'),
    ('apartment', '38', '5'),
    ('apartment', '39', '5'),
    ('apartment', '40', '5'),
    ('apartment', '41', '5'),
    ('apartment', '42', '5'),
    ('apartment', '43', '6'),
    ('apartment', '44', '6'),
    ('apartment', '45', '6'),
    -- Ателиета
    ('atelier', '1', '1'),
    ('atelier', '2', '2'),
    ('atelier', '3', '3'),
    ('atelier', '4', '4'),
    ('atelier', '5', '5'),
    ('atelier', '6', '6')
) AS v(group_code, unit_number, floor)
JOIN public.unit_groups g ON g.code = v.group_code
WHERE u.group_id = g.id
  AND u.number = v.unit_number;
