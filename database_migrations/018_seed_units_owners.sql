-- Импорт на единици и собственици (магазини, апартаменти, ателиета, паркоместа).
-- Паркоместата са със собственик като посочения апартамент.
-- Идемпотентно: ON CONFLICT (group_id, number) DO UPDATE.
-- Изисква: unit_groups с code shop, apartment, atelier, parking (както в database_v2).
-- Изпълни в Supabase → SQL Editor.

INSERT INTO public.units (group_id, number, area, owner_name, owner_phone, owner_email, opening_balance, notes)
SELECT g.id, v.number, v.area, v.owner_name, v.owner_phone, v.owner_email, 0, v.notes
FROM (VALUES
  -- Магазини (area по подразбиране за имот)
  ('shop', '1', 45::numeric, 'Боян Петров', '0886763833', 'uard@uard.bg', NULL::text),
  ('shop', '2', 45::numeric, 'Боян Петров', '0886763833', 'uard@uard.bg', NULL::text),
  ('shop', '3', 45::numeric, 'Ирина Славчева', '0896615042', 'iraslaff@abv.bg', NULL::text),
  ('shop', '4', 45::numeric, 'Ремос', '0888928437', 'remos@dir.bg', NULL::text),
  -- Апартаменти
  ('apartment', '1', 65::numeric, 'София Делипавлова', '00447543737902', 'sofiadelipavlova@gmail.com', NULL::text),
  ('apartment', '2', 65::numeric, 'Георги Богоев', '0888620524', NULL::text, NULL::text),
  ('apartment', '3', 65::numeric, 'Петър Милев', '0897906755', 'petar.milev@milev-lawfirm.com', NULL::text),
  ('apartment', '4', 65::numeric, 'Рене Накова', '0886959598', NULL::text, NULL::text),
  ('apartment', '5', 65::numeric, 'Цветелина Караджиева', '0897493242', 'tzvetelina_karadjieva@abv.bg', NULL::text),
  ('apartment', '6', 65::numeric, 'Николай Топуров', '0878679937', 'nikolaitopurov1@gmail.com', NULL::text),
  ('apartment', '7', 65::numeric, 'Нина Папалакова', '0894637151', NULL::text, NULL::text),
  ('apartment', '8', 65::numeric, 'Николай Кирков', '0896355801', NULL::text, NULL::text),
  ('apartment', '9', 65::numeric, 'Мартин Мадемджиев', '0898415627', 'matdjet123@abv.bg', NULL::text),
  ('apartment', '10', 65::numeric, 'Ивайло Енев', '0898632014', 'ivaylo.enev@gmail.com', NULL::text),
  ('apartment', '11', 65::numeric, 'Нуртен Иляз', '0882340079', 'khiasss@abv.bg', NULL::text),
  ('apartment', '12', 65::numeric, 'Николай Пенчев', '0878951555', 'nikpentchev@yahoo.com', NULL::text),
  ('apartment', '13', 65::numeric, 'Шефкет Халимов', '0886954653', 'shefket_shefik@abv.bg', NULL::text),
  ('apartment', '14', 65::numeric, 'Евелина Георгиева', '0898728941', 'evi_87@abv.bg', NULL::text),
  ('apartment', '15', 65::numeric, 'Ангел Динев', '0899893370', 'adinev77@abv.bg', NULL::text),
  ('apartment', '16', 65::numeric, 'Добромир Костов', '0883327834', 'dobata_gabrovo@abv.bg', NULL::text),
  ('apartment', '17', 65::numeric, 'Ели Божева', '0894403634', 'elka.bojeva@abv.bg', NULL::text),
  ('apartment', '18', 65::numeric, 'Иван Щипков', '0882055390', 'ivanshtipkov@icloud.com', NULL::text),
  ('apartment', '19', 65::numeric, 'Васил Вълчанов', '0896818346', 'vaseto_v@abv.bg', NULL::text),
  ('apartment', '20', 65::numeric, 'Нели Йорданова', '0897719580', 'ioanstoykov@gmail.com', NULL::text),
  ('apartment', '21', 65::numeric, 'Мария Момина', '0894615262', 'dzsr.rudozem@dir.bg', NULL::text),
  ('apartment', '22', 65::numeric, 'Мая Павлова', '0898343686', 'mpavlova57@abv.bg', NULL::text),
  ('apartment', '23', 65::numeric, 'Славка Понева', '0887894453', 'slava60@abv.bg', NULL::text),
  ('apartment', '24', 65::numeric, 'Стефан Пашалиев', '0898566045', 'stefanpetrov73@gmail.com', NULL::text),
  ('apartment', '25', 65::numeric, 'Димитър Нейчев', '0886715033', 'dimitarneychev75@gmail.com', NULL::text),
  ('apartment', '26', 65::numeric, 'Елка Желязкова', '0884685415', NULL::text, NULL::text),
  ('apartment', '27', 65::numeric, 'Пламен Кънчев', '0876776762', 'pik64@abv.bg', NULL::text),
  ('apartment', '28', 65::numeric, 'Евелина Хаджиева', '0899847228', 'eve_mm@abv.bg', NULL::text),
  ('apartment', '29', 65::numeric, 'Мария Бъбарова', '0876867635', 'mariababarova@gmail.com', NULL::text),
  ('apartment', '30', 65::numeric, 'Десислава Петкова', '0888651455', 'desipetkova1975@abv.bg', NULL::text),
  ('apartment', '31', 65::numeric, 'Искра Ангелова', '0899820205', 'iskra_angelov@abv.bg', NULL::text),
  ('apartment', '32', 65::numeric, 'Стоян Цолов', '0885408799', 'stojaan@gmail.com', NULL::text),
  ('apartment', '33', 65::numeric, 'Димитрия Георгиева', '0896838811', 'universal_95@abv.bg', NULL::text),
  ('apartment', '34', 65::numeric, 'Георги Кумчев', '004915145615166', 'aries_1984@abv.bg', NULL::text),
  ('apartment', '35', 65::numeric, 'Николай Стоянов', '0887645554', 'n.stoyanov82@abv.bg', NULL::text),
  ('apartment', '36', 65::numeric, 'Денислав Лефтеров', '0883394396', 'denislav.lefterov@gmail.com', NULL::text),
  ('apartment', '37', 65::numeric, 'Костадин Николов', '0886103060', 'kostadin_nikolov@gbg.bg', NULL::text),
  ('apartment', '38', 65::numeric, 'Боряна Димова', '0883461827', 'vanda_bg@abv.bg', NULL::text),
  ('apartment', '39', 65::numeric, 'Никола Чомаков', '0897058363', 'chomakovnikola@yahoo.co.uk', NULL::text),
  ('apartment', '40', 65::numeric, 'Таня Хъркова', '00447427917815', 'tanitaxxx@icloud.com', NULL::text),
  ('apartment', '41', 65::numeric, 'Десислава Севданска', '0893481071', 'sevdanska6@gmail.com', NULL::text),
  ('apartment', '42', 65::numeric, 'Гроздан Динев', '0882501913', 'onid@abv.bg', NULL::text),
  ('apartment', '43', 65::numeric, 'Галимир Николов', '0889120540', 'galimir.nikolov@gmail.com', NULL::text),
  ('apartment', '44', 65::numeric, 'Марко Христов Соликов', NULL::text, NULL::text, NULL::text),
  ('apartment', '45', 65::numeric, 'Петя Аксиева', '0889118831', 'petiamil@abv.bg', NULL::text),
  -- Ателиета
  ('atelier', '1', 35::numeric, 'Недялка Пулевска', '0884701025', 'mar38@abv.bg', NULL::text),
  ('atelier', '2', 35::numeric, 'Рамадан Алиев', '0887460580', 'ramadanaliev@gmail.com', NULL::text),
  ('atelier', '3', 35::numeric, 'Живка Куртева', '0889112346', NULL::text, NULL::text),
  ('atelier', '4', 35::numeric, 'Марко Солинков', '0885716626', 'm.solinkov@gmail.com', NULL::text),
  ('atelier', '5', 35::numeric, 'Ивелина Налбантова', '0896705293', 'ivadi82@abv.bg', NULL::text),
  ('atelier', '6', 35::numeric, 'Славея Младенова', '0877177749', 'slavei4eto91@abv.bg', NULL::text),
  -- Паркоместа (собственик = на апартамента от бележката)
  ('parking', '1', 12::numeric, 'Стоян Цолов', '0885408799', 'stojaan@gmail.com', 'Към ап. 32'::text),
  ('parking', '2', 12::numeric, 'Нина Папалакова', '0894637151', NULL::text, 'Към ап. 7'::text),
  ('parking', '3', 12::numeric, 'Васил Вълчанов', '0896818346', 'vaseto_v@abv.bg', 'Към ап. 19'::text),
  ('parking', '4', 12::numeric, 'Николай Кирков', '0896355801', NULL::text, 'Към ап. 8'::text),
  ('parking', '5', 12::numeric, 'Петър Милев', '0897906755', 'petar.milev@milev-lawfirm.com', 'Към ап. 3'::text),
  ('parking', '6', 12::numeric, 'Петя Аксиева', '0889118831', 'petiamil@abv.bg', 'Към ап. 45'::text)
) AS v(group_code, number, area, owner_name, owner_phone, owner_email, notes)
JOIN public.unit_groups g ON g.code = v.group_code
ON CONFLICT (group_id, number) DO UPDATE SET
  owner_name = EXCLUDED.owner_name,
  owner_phone = EXCLUDED.owner_phone,
  owner_email = EXCLUDED.owner_email,
  area = EXCLUDED.area,
  notes = EXCLUDED.notes,
  updated_at = NOW();
