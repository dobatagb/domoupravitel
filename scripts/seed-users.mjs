/**
 * Сийд на потребители с пароли чрез Supabase Auth Admin API.
 *
 * Изисква service role ключ (само локално / CI, НЕ в клиента и НЕ в git).
 *
 * Настройка: коренов `.env` (и по избор `.env.local` за презапис) с VITE_SUPABASE_URL и
 * SUPABASE_SERVICE_ROLE_KEY, или в PowerShell:
 *   $env:VITE_SUPABASE_URL="https://xxxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   $env:SEED_ADMIN_EMAIL="admin@local.test"
 *   $env:SEED_ADMIN_PASSWORD="your-secure-password"
 *   npm run seed-users
 *
 * По избор: SEED_EDITOR_EMAIL / SEED_EDITOR_PASSWORD, SEED_VIEWER_EMAIL / SEED_VIEWER_PASSWORD
 */

import { createClient } from '@supabase/supabase-js'
import { loadDotEnv } from './load-env.mjs'

loadDotEnv()

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const seeds = [
  {
    key: 'admin',
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
    role: 'admin',
  },
  {
    key: 'editor',
    email: process.env.SEED_EDITOR_EMAIL,
    password: process.env.SEED_EDITOR_PASSWORD,
    role: 'editor',
  },
  {
    key: 'viewer',
    email: process.env.SEED_VIEWER_EMAIL,
    password: process.env.SEED_VIEWER_PASSWORD,
    role: 'viewer',
  },
].filter((s) => s.email && s.password)

async function main() {
  if (!url || !serviceKey) {
    console.error(
      'Липсват VITE_SUPABASE_URL (или SUPABASE_URL) и/или SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Ключът е в Supabase → Settings → API → service_role (секретен).'
    )
    process.exit(1)
  }

  if (seeds.length === 0) {
    console.error(
      'Няма зададени потребители. Задай поне SEED_ADMIN_EMAIL и SEED_ADMIN_PASSWORD (и по избор editor/viewer).'
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

  for (const s of seeds) {
    let userId

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: s.email,
      password: s.password,
      email_confirm: true,
    })

    if (!createErr && created.user) {
      userId = created.user.id
      console.log(`[${s.key}] Създаден: ${s.email}`)
    } else if (
      createErr &&
      (String(createErr.message).toLowerCase().includes('already') ||
        String(createErr.message).toLowerCase().includes('registered'))
    ) {
      const existing = await findAuthUserByEmail(s.email)
      if (!existing) throw createErr
      console.log(`[${s.key}] Вече съществува: ${s.email} — обновявам парола.`)
      const { data: upd, error: upErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password: s.password,
        email_confirm: true,
      })
      if (upErr) throw upErr
      userId = upd.user?.id ?? existing.id
    } else {
      throw createErr || new Error('Неуспешно създаване')
    }

    const { error: roleErr } = await supabase.from('users').upsert(
      { id: userId, email: s.email, role: s.role },
      { onConflict: 'id' }
    )
    if (roleErr) throw roleErr
    console.log(`[${s.key}] Роля в public.users: ${s.role}`)
  }

  console.log('Готово.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
