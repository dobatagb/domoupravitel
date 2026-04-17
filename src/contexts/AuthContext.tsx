import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { UserRole } from '../lib/supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  userRole: UserRole | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, role: UserRole) => Promise<void>
  signOut: () => Promise<void>
  canEdit: () => boolean
  refreshUserRole: () => Promise<void>
  refreshUserRoleById: (userId: string) => Promise<void>
  setIgnoreRoleUpdateFlag: (value: boolean) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [ignoreRoleUpdate, setIgnoreRoleUpdate] = useState(false)
  
  // Използваме refs за да имаме достъп до актуалните стойности в onAuthStateChange
  const ignoreRoleUpdateRef = useRef(false)
  const userRoleRef = useRef<UserRole | null>(null)
  const userRef = useRef<User | null>(null)
  /** Игнорира остарели отговори при паралелни извиквания на fetchUserRole */
  const fetchUserRoleSeq = useRef(0)
  
  // Обновяваме refs когато state-а се променя
  useEffect(() => {
    ignoreRoleUpdateRef.current = ignoreRoleUpdate
  }, [ignoreRoleUpdate])
  
  useEffect(() => {
    userRoleRef.current = userRole
  }, [userRole])
  
  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    let isActive = true

    /** Само ако нито getSession, нито onAuthStateChange не приключат (много рядко) */
    const SAFETY_MS = 45_000

    const safetyTimer = window.setTimeout(() => {
      if (isActive) {
        console.warn('[Auth] Няма отговор от Supabase Auth — махаме спинера; провери мрежата и .env ключовете.')
        setLoading(false)
      }
    }, SAFETY_MS)

    const clearInitSafety = () => {
      window.clearTimeout(safetyTimer)
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!isActive) return
        console.log('Initial session:', session?.user?.email)
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          void fetchUserRole(session.user.id).catch((err) => {
            console.error('Failed to fetch user role:', err)
            if (!isActive) return
            setUserRole('viewer')
          })
        } else {
          setUserRole(null)
        }
        // Винаги махаме спинера след като сесията е известна (ролята може да дойде малко след това)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to get session:', err)
        if (isActive) setLoading(false)
      })
      .finally(() => {
        if (isActive) clearInitSafety()
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isActive) return

      try {
        console.log('Auth state changed:', event, session?.user?.email)

        if (ignoreRoleUpdateRef.current && session?.user) {
          console.log('Ignoring auth state change due to ignoreRoleUpdate flag')
          return
        }

        if (userRoleRef.current === 'admin' && session?.user?.id === userRef.current?.id) {
          console.log('User is already admin, skipping role update')
          setSession(session)
          setUser(session?.user ?? null)
          return
        }

        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          // Без await — ако заявката към public.users зависне, да не блокираме finally и „Зареждане...“
          void fetchUserRole(session.user.id).catch((err) => {
            console.error('Error in fetchUserRole during auth change:', err)
            if (isActive) setUserRole('viewer')
          })
        } else {
          setUserRole(null)
        }
      } finally {
        if (isActive) {
          clearInitSafety()
          setLoading(false)
        }
      }
    })

    return () => {
      isActive = false
      clearInitSafety()
      subscription.unsubscribe()
    }
  }, [])

  const fetchUserRole = async (userId: string) => {
    console.log('Fetching user role for:', userId)
    const seq = ++fetchUserRoleSeq.current
    setLoading(false)

    try {
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle()

      if (seq !== fetchUserRoleSeq.current) return

      if (error) {
        console.warn('Error fetching role:', error.message)
        setUserRole('viewer')
        return
      }

      const role = data?.role as UserRole | undefined
      if (role === 'admin' || role === 'editor' || role === 'viewer') {
        console.log('User role found:', role)
        setUserRole(role)
      } else if (role) {
        console.warn('Unknown role value, defaulting to viewer:', role)
        setUserRole('viewer')
      } else {
        console.warn('User record not found in public.users, using viewer')
        setUserRole('viewer')
      }
    } catch (error: unknown) {
      if (seq !== fetchUserRoleSeq.current) return
      console.error('Exception in fetchUserRole:', error)
      setUserRole('viewer')
    }
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    if (data.user) {
      // Wait for user role to be fetched before returning
      await fetchUserRole(data.user.id)
      // Small delay to ensure state is updated
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  const signUp = async (email: string, password: string, role: UserRole) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    
    if (error) {
      console.error('Signup error:', error)
      throw new Error(error.message || 'Грешка при регистрация')
    }
    
    if (!data.user) {
      throw new Error('Неуспешна регистрация - потребителят не е създаден')
    }

    // Check if email confirmation is required
    if (data.user && !data.session) {
      // Email confirmation is required - user needs to confirm email first
      throw new Error('Моля, проверете имейла си и кликнете на линка за потвърждение преди да влезете.')
    }

    // Wait a bit for the trigger to create the user record
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Try to update the role (trigger creates user with 'viewer' by default)
    let userError = null
    const { error: updateError } = await supabase
      .from('users')
      .update({ role, email })
      .eq('id', data.user.id)
    
    userError = updateError
    
    if (userError) {
      console.warn('Update failed, trying insert:', userError)
      // If update fails, try to insert (in case trigger didn't fire)
      const { error: insertError } = await supabase
        .from('users')
        .insert({ id: data.user.id, email, role })
      
      if (insertError) {
        console.error('Insert also failed:', insertError)
        // Don't throw - user is created in auth, we can update role later
        // Just log the error
      }
    }
    
    // If we have a session, fetch user role
    if (data.session) {
      await fetchUserRole(data.user.id)
    }
  }

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } finally {
      fetchUserRoleSeq.current += 1
      setSession(null)
      setUser(null)
      setUserRole(null)
      setLoading(false)
    }
  }

  const canEdit = () => {
    return userRole === 'admin' || userRole === 'editor'
  }

  const refreshUserRole = async () => {
    if (user?.id) {
      await fetchUserRole(user.id)
    }
  }

  const refreshUserRoleById = async (userId: string) => {
    // Обновяваме ролята директно без да задаваме default 'viewer'
    // Това предотвратява проблеми когато обновяваме ролята на администратора
    try {
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
      
      if (error) {
        console.warn('Error fetching role:', error)
        return
      }
      
      if (data?.role) {
        console.log('Setting user role to:', data.role)
        setUserRole(data.role)
        setLoading(false)
      } else {
        console.warn('User role not found, keeping current role')
      }
    } catch (err) {
      console.error('Exception in refreshUserRoleById:', err)
    }
  }

  const setIgnoreRoleUpdateFlag = (value: boolean) => {
    setIgnoreRoleUpdate(value)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        userRole,
        loading,
        signIn,
        signUp,
        signOut,
        canEdit,
        refreshUserRole,
        refreshUserRoleById,
        setIgnoreRoleUpdateFlag,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

