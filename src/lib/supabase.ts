import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Липсват VITE_SUPABASE_URL или VITE_SUPABASE_ANON_KEY. Копирай .env.example в .env и попълни стойностите от Supabase → Settings → API.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  },
})

/**
 * Обвива PostgREST заявката в истински Promise.
 * Builder-ът е thenable, но директно в някои `Promise.race`/async сценарии може да не се разреши надеждно.
 * Без таймаут — бавна мрежа/Supabase няма да „гърми“ изкуствено след N секунди.
 */
export async function supabaseQuery<T>(run: () => PromiseLike<T>): Promise<T> {
  return Promise.resolve(run())
}

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  role: UserRole
  created_at: string
}

