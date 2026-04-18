/**
 * Сийд на собственици (viewer) + връзки към единици (user_unit_links).
 * Данните следват database_migrations/018_seed_units_owners.sql (обекти по група + номер).
 *
 * Имейл: ако в данните има имейл — ползва се; иначе firstname.lastname@dom.bg (латиница,
 * за 3+ имена: първо + последно име).
 * Парола за всички: 123456 (или SEED_OWNER_PASSWORD).
 *
 * Изисква: VITE_SUPABASE_URL (или SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY в `.env` / `.env.local`.
 *   npm run seed-owners
 *
 * Ако имейлът вече е admin/editor, не се сменя парола/роля — само се добавят линкове към единици.
 */

import { createClient } from '@supabase/supabase-js'
import { loadDotEnv } from './load-env.mjs'

loadDotEnv()

const PASSWORD = process.env.SEED_OWNER_PASSWORD || '123456'

/** @type {Array<[groupCode: string, number: string, ownerName: string, emailOrNull: string | null]>} */
const OWNER_ROWS = [
  ['shop', '1', 'Боян Петров', 'uard@uard.bg'],
  ['shop', '2', 'Боян Петров', 'uard@uard.bg'],
  ['shop', '3', 'Ирина Славчева', 'iraslaff@abv.bg'],
  ['shop', '4', 'Ремос', 'remos@dir.bg'],
  ['apartment', '1', 'София Делипавлова', 'sofiadelipavlova@gmail.com'],
  ['atelier', '1', 'Недялка Пулевска', 'mar38@abv.bg'],
  ['apartment', '2', 'Георги Богоев', null],
  ['apartment', '3', 'Петър Милев', 'petar.milev@milev-lawfirm.com'],
  ['apartment', '4', 'Рене Накова', null],
  ['apartment', '5', 'Цветелина Караджиева', 'tzvetelina_karadjieva@abv.bg'],
  ['apartment', '6', 'Николай Топуров', 'nikolaitopurov1@gmail.com'],
  ['apartment', '7', 'Нина Папалакова', null],
  ['apartment', '8', 'Николай Кирков', null],
  ['apartment', '9', 'Мартин Мадемджиев', 'matdjet123@abv.bg'],
  ['atelier', '2', 'Рамадан Алиев', 'ramadanaliev@gmail.com'],
  ['apartment', '10', 'Ивайло Енев', 'ivaylo.enev@gmail.com'],
  ['apartment', '11', 'Нуртен Иляз', 'khiasss@abv.bg'],
  ['apartment', '12', 'Николай Пенчев', 'nikpentchev@yahoo.com'],
  ['apartment', '13', 'Шефкет Халимов', 'shefket_shefik@abv.bg'],
  ['apartment', '14', 'Евелина Георгиева', 'evi_87@abv.bg'],
  ['apartment', '15', 'Ангел Динев', 'adinev77@abv.bg'],
  ['apartment', '16', 'Добромир Костов', 'dobata_gabrovo@abv.bg'],
  ['apartment', '17', 'Ели Божева', 'elka.bojeva@abv.bg'],
  ['apartment', '18', 'Иван Щипков', 'ivanshtipkov@icloud.com'],
  ['atelier', '3', 'Живка Куртева', null],
  ['apartment', '19', 'Васил Вълчанов', 'vaseto_v@abv.bg'],
  ['apartment', '20', 'Нели Йорданова', 'ioanstoykov@gmail.com'],
  ['apartment', '21', 'Мария Момина', 'dzsr.rudozem@dir.bg'],
  ['apartment', '22', 'Мая Павлова', 'mpavlova57@abv.bg'],
  ['apartment', '23', 'Славка Понева', 'slava60@abv.bg'],
  ['apartment', '24', 'Стефан Пашалиев', 'stefanpetrov73@gmail.com'],
  ['apartment', '25', 'Димитър Нейчев', 'dimitarneychev75@gmail.com'],
  ['apartment', '26', 'Елка Желязкова', null],
  ['apartment', '27', 'Пламен Кънчев', 'pik64@abv.bg'],
  ['atelier', '4', 'Марко Солинков', 'm.solinkov@gmail.com'],
  ['apartment', '28', 'Евелина Хаджиева', 'eve_mm@abv.bg'],
  ['apartment', '29', 'Мария Бъбарова', 'mariababarova@gmail.com'],
  ['apartment', '30', 'Десислава Петкова', 'desipetkova1975@abv.bg'],
  ['apartment', '31', 'Искра Ангелова', 'iskra_angelov@abv.bg'],
  ['apartment', '32', 'Стоян Цолов', 'stojaan@gmail.com'],
  ['apartment', '33', 'Димитрия Георгиева', 'universal_95@abv.bg'],
  ['apartment', '34', 'Георги Кумчев', 'aries_1984@abv.bg'],
  ['apartment', '35', 'Николай Стоянов', 'n.stoyanov82@abv.bg'],
  ['apartment', '36', 'Денислав Лефтеров', 'denislav.lefterov@gmail.com'],
  ['atelier', '5', 'Ивелина Налбантова', 'ivadi82@abv.bg'],
  ['apartment', '37', 'Костадин Николов', 'kostadin_nikolov@gbg.bg'],
  ['apartment', '38', 'Боряна Димова', 'vanda_bg@abv.bg'],
  ['apartment', '39', 'Никола Чомаков', 'chomakovnikola@yahoo.co.uk'],
  ['apartment', '40', 'Таня Хъркова', 'tanitaxxx@icloud.com'],
  ['apartment', '41', 'Десислава Севданска', 'sevdanska6@gmail.com'],
  ['apartment', '42', 'Гроздан Динев', 'onid@abv.bg'],
  ['atelier', '6', 'Славея Младенова', 'slavei4eto91@abv.bg'],
  ['apartment', '43', 'Галимир Николов', 'galimir.nikolov@gmail.com'],
  ['apartment', '44', 'Марко Христов Соликов', null],
  ['apartment', '45', 'Петя Аксиева', 'petiamil@abv.bg'],
  ['parking', '1', 'Стоян Цолов', 'stojaan@gmail.com'],
  ['parking', '2', 'Нина Папалакова', null],
  ['parking', '3', 'Васил Вълчанов', 'vaseto_v@abv.bg'],
  ['parking', '4', 'Николай Кирков', null],
  ['parking', '5', 'Петър Милев', 'petar.milev@milev-lawfirm.com'],
  ['parking', '6', 'Петя Аксиева', 'petiamil@abv.bg'],
]

/** Поредност: по-дълги първо (дву-буквени кодове). */
const BG_SEQ = [
  ['щ', 'sht'],
  ['ь', 'y'],
  ['ъ', 'a'],
  ['ю', 'yu'],
  ['я', 'ya'],
  ['ж', 'zh'],
  ['ч', 'ch'],
  ['ш', 'sh'],
  ['ц', 'ts'],
  ['а', 'a'],
  ['б', 'b'],
  ['в', 'v'],
  ['г', 'g'],
  ['д', 'd'],
  ['е', 'e'],
  ['з', 'z'],
  ['и', 'i'],
  ['й', 'y'],
  ['к', 'k'],
  ['л', 'l'],
  ['м', 'm'],
  ['н', 'n'],
  ['о', 'o'],
  ['п', 'p'],
  ['р', 'r'],
  ['с', 's'],
  ['т', 't'],
  ['у', 'u'],
  ['ф', 'f'],
  ['х', 'h'],
]

function transliterateWord(word) {
  let s = word.toLowerCase()
  for (const [bg, lat] of BG_SEQ) {
    s = s.split(bg).join(lat)
  }
  return s.replace(/[^a-z0-9]/g, '')
}

function normalizeOwnerName(name) {
  return name.replace(/^["'\s]+|["'\s]+$/g, '').trim()
}

/**
 * @param {string} fullName
 * @returns {{ first: string, last: string }}
 */
function firstLastLatin(fullName) {
  const n = normalizeOwnerName(fullName)
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: 'user', last: 'user' }
  if (parts.length === 1) {
    const one = transliterateWord(parts[0]) || 'user'
    return { first: one, last: one }
  }
  const first = transliterateWord(parts[0]) || 'user'
  const last = transliterateWord(parts[parts.length - 1]) || 'user'
  return { first, last }
}

function emailFromName(fullName) {
  const { first, last } = firstLastLatin(fullName)
  return `${first}.${last}@dom.bg`.toLowerCase()
}

function resolveEmail(ownerName, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim().toLowerCase()
  return emailFromName(ownerName)
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error(
      'Липсват VITE_SUPABASE_URL (или SUPABASE_URL) и/или SUPABASE_SERVICE_ROLE_KEY.'
    )
    process.exit(1)
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  async function findAuthUserByEmail(email) {
    const target = email.toLowerCase()
    let page = 1
    const perPage = 1000
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
      if (error) throw error
      const u = data.users.find((x) => x.email?.toLowerCase() === target)
      if (u) return u
      if (!data.users.length || data.users.length < perPage) return null
      page += 1
      if (page > 50) return null
    }
  }

  // Без embed: при някои проекти `group:group_id(code)` връща празно и магазини/ателиета изчезват от картата.
  const { data: groupsRaw, error: groupsErr } = await supabase.from('unit_groups').select('id, code')
  if (groupsErr) throw groupsErr
  const groupIdToCode = new Map((groupsRaw || []).map((g) => [g.id, g.code]))

  const { data: unitsRaw, error: unitsErr } = await supabase.from('units').select('id, number, group_id')
  if (unitsErr) throw unitsErr

  /** @type {Map<string, string>} key `${code}:${number}` -> unit id */
  const unitByKey = new Map()
  for (const u of unitsRaw || []) {
    const code = u.group_id ? groupIdToCode.get(u.group_id) : undefined
    if (!code) continue
    const num = u.number == null ? '' : String(u.number).trim()
    unitByKey.set(`${code}:${num}`, u.id)
  }

  /** @type {Map<string, { email: string, unitKeys: Set<string> }>} */
  const byEmail = new Map()
  for (const [gc, num, owner, explicit] of OWNER_ROWS) {
    const email = resolveEmail(owner, explicit)
    const key = `${gc}:${String(num)}`
    if (!byEmail.has(email)) {
      byEmail.set(email, { email, unitKeys: new Set() })
    }
    byEmail.get(email).unitKeys.add(key)
  }

  for (const { email, unitKeys } of byEmail.values()) {
    let userId

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })

    if (!createErr && created.user) {
      userId = created.user.id
      console.log(`Създаден auth: ${email}`)
    } else if (
      createErr &&
      (String(createErr.message).toLowerCase().includes('already') ||
        String(createErr.message).toLowerCase().includes('registered'))
    ) {
      const existing = await findAuthUserByEmail(email)
      if (!existing) throw createErr
      userId = existing.id
      const { data: roleRow } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
      const role = roleRow?.role
      if (role === 'admin' || role === 'editor') {
        console.log(`Вече съществува (${role}): ${email} — само линкове към единици.`)
      } else {
        const { error: upErr } = await supabase.auth.admin.updateUserById(userId, {
          password: PASSWORD,
          email_confirm: true,
        })
        if (upErr) throw upErr
        console.log(`Обновена парола: ${email}`)
      }
    } else {
      throw createErr || new Error('Неуспешно създаване')
    }

    const { data: roleRow } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
    const role = roleRow?.role
    if (role !== 'admin' && role !== 'editor') {
      const { error: roleErr } = await supabase.from('users').upsert(
        { id: userId, email, role: 'viewer' },
        { onConflict: 'id' }
      )
      if (roleErr) throw roleErr
    }

    for (const uk of unitKeys) {
      const unitId = unitByKey.get(uk)
      if (!unitId) {
        console.warn(`Няма единица в БД за ${uk} — пропускам линк за ${email}`)
        continue
      }
      const { error: linkErr } = await supabase.from('user_unit_links').upsert(
        { user_id: userId, unit_id: unitId },
        { onConflict: 'user_id,unit_id' }
      )
      if (linkErr) throw linkErr
    }
    console.log(`Линкове: ${email} → ${unitKeys.size} единици`)
  }

  console.log('Готово (собственици + user_unit_links).')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
