import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

export type NotificationKind =
  | 'meeting_created'
  | 'agenda_item_opened'
  | 'agenda_item_closed'
  | 'meeting_minutes'

export type NotificationRow = {
  id: string
  user_id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

type NotificationsContextValue = {
  loading: boolean
  items: NotificationRow[]
  unreadCount: number
  markAllRead: () => Promise<void>
  markRead: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined)

const PAGE_SIZE = 20

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id

  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(false)
  const userIdRef = useRef<string | undefined>(userId)

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  const fetchInitial = useCallback(async () => {
    if (!userIdRef.current) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userIdRef.current)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (error) throw error
      setItems((data as NotificationRow[]) ?? [])
    } catch (err) {
      console.warn('[Notifications] fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setItems([])
      return
    }
    void fetchInitial()
  }, [userId, fetchInitial])

  // Realtime subscribe — само за нашия user.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow
          setItems((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev
            return [row, ...prev].slice(0, PAGE_SIZE)
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow
          setItems((prev) => prev.map((p) => (p.id === row.id ? row : p)))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const old = payload.old as Partial<NotificationRow>
          if (!old?.id) return
          setItems((prev) => prev.filter((p) => p.id !== old.id))
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items])

  const markAllRead = useCallback(async () => {
    if (!userIdRef.current) return
    const now = new Date().toISOString()
    setItems((prev) => prev.map((p) => (p.read_at ? p : { ...p, read_at: now })))
    const { error } = await supabase.rpc('notifications_mark_all_read')
    if (error) {
      console.warn('[Notifications] mark all read failed:', error.message)
      void fetchInitial()
    }
  }, [fetchInitial])

  const markRead = useCallback(
    async (id: string) => {
      if (!userIdRef.current) return
      const target = items.find((p) => p.id === id)
      if (!target || target.read_at) return
      const now = new Date().toISOString()
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, read_at: now } : p)))
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('id', id)
        .eq('user_id', userIdRef.current)
      if (error) {
        console.warn('[Notifications] mark read failed:', error.message)
        void fetchInitial()
      }
    },
    [items, fetchInitial]
  )

  const value = useMemo<NotificationsContextValue>(
    () => ({
      loading,
      items,
      unreadCount,
      markAllRead,
      markRead,
      refresh: fetchInitial,
    }),
    [loading, items, unreadCount, markAllRead, markRead, fetchInitial]
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications трябва да се ползва вътре в <NotificationsProvider>.')
  }
  return ctx
}
