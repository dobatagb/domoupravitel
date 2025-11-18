import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jraihoszdtzzhwnmpvjx.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyYWlob3N6ZHR6emh3bm1wdmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjA1MzksImV4cCI6MjA3ODY5NjUzOX0.WsyAs_Ssen7xMIfE9IxzNxA8ytZroE1L6YHRN76Hdjo'

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

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  role: UserRole
  created_at: string
}

