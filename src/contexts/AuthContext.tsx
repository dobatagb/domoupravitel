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
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Initial session:', session?.user?.email)
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchUserRole(session.user.id).catch(err => {
          console.error('Failed to fetch user role:', err)
          setUserRole('viewer')
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
    }).catch(err => {
      console.error('Failed to get session:', err)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email)
      
      // Ако ignoreRoleUpdate е true, не обновяваме state-а и ролята
      // Това се използва когато създаваме нов потребител и се опитваме да се върнем към администратора
      if (ignoreRoleUpdateRef.current) {
        console.log('Ignoring auth state change due to ignoreRoleUpdate flag')
        return
      }
      
      // Ако ролята вече е 'admin' и сесията е на същия потребител, не обновяваме ролята
      // Това предотвратява случайно обновяване на ролята след създаване на нов потребител
      if (userRoleRef.current === 'admin' && session?.user?.id === userRef.current?.id) {
        console.log('User is already admin, skipping role update')
        setSession(session)
        setUser(session?.user ?? null)
        return
      }
      
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        try {
          await fetchUserRole(session.user.id)
        } catch (err) {
          console.error('Error in fetchUserRole during auth change:', err)
          setUserRole('viewer')
          setLoading(false)
        }
      } else {
        setUserRole(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserRole = async (userId: string) => {
    console.log('Fetching user role for:', userId)
    
    // Set loading to false immediately to prevent infinite loading
    // We'll update the role asynchronously
    setLoading(false)
    setUserRole('viewer') // Default role
    
    try {
      // Try to fetch user role with a shorter timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 3000)
      )
      
      const queryPromise = supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle()

      const result = await Promise.race([queryPromise, timeoutPromise]) as any
      
      if (result && result.data) {
        console.log('User role found:', result.data.role)
        setUserRole(result.data.role || 'viewer')
      } else if (result && result.error) {
        console.warn('Error fetching role, using default:', result.error.message)
      } else {
        console.warn('User record not found, using default role')
      }
    } catch (error: any) {
      if (error.message === 'Timeout') {
        console.warn('Timeout fetching user role, using default role')
      } else {
        console.error('Exception in fetchUserRole:', error)
      }
      // Already set to viewer and loading to false above
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
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUserRole(null)
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

