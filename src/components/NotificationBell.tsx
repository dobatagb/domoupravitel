import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Calendar, FileText, Vote } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { useNotifications, type NotificationKind, type NotificationRow } from '../contexts/NotificationsContext'
import './NotificationBell.css'

type Props = {
  /** За aria-label на бутона; иначе използва дефаулт. */
  ariaLabel?: string
  /** Допълнителен class на контейнера (за разполагане в sidebar vs mobile header). */
  className?: string
  /** Колко от dropdown-а да показваме отгоре vs отдолу — default 'bottom'. */
  align?: 'left' | 'right'
}

const KIND_ICON: Record<NotificationKind, typeof Calendar> = {
  meeting_created: Calendar,
  agenda_item_opened: Vote,
  agenda_item_closed: Vote,
  meeting_minutes: FileText,
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'преди миг'
  if (diffMin < 60) return `преди ${diffMin} мин`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `преди ${diffH} ч`
  return format(d, 'dd.MM.yyyy HH:mm', { locale: bg })
}

export default function NotificationBell({ ariaLabel, className, align = 'right' }: Props) {
  const navigate = useNavigate()
  const { items, unreadCount, markAllRead, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleItemClick = useCallback(
    (n: NotificationRow) => {
      void markRead(n.id)
      if (n.link) navigate(n.link)
      setOpen(false)
    },
    [markRead, navigate]
  )

  return (
    <div
      ref={wrapperRef}
      className={`notif-bell notif-bell--align-${align}${className ? ' ' + className : ''}`}
    >
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={ariaLabel ?? `Уведомления${unreadCount > 0 ? ` (${unreadCount} непрочетени)` : ''}`}
        title="Уведомления"
      >
        <Bell size={20} aria-hidden />
        {unreadCount > 0 ? (
          <span className="notif-bell-badge" aria-hidden>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-bell-panel" role="dialog" aria-label="Уведомления">
          <div className="notif-bell-panel-head">
            <span className="notif-bell-panel-title">Уведомления</span>
            <button
              type="button"
              className="notif-bell-panel-mark"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Прочети всички
            </button>
          </div>

          {items.length === 0 ? (
            <p className="notif-bell-empty">Няма уведомления.</p>
          ) : (
            <ul className="notif-bell-list">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell
                const unread = !n.read_at
                return (
                  <li key={n.id} className={`notif-bell-item${unread ? ' is-unread' : ''}`}>
                    <button
                      type="button"
                      className="notif-bell-item-btn"
                      onClick={() => handleItemClick(n)}
                    >
                      <span className="notif-bell-item-icon" aria-hidden>
                        <Icon size={16} />
                      </span>
                      <span className="notif-bell-item-body">
                        <span className="notif-bell-item-title">{n.title}</span>
                        {n.body ? <span className="notif-bell-item-text">{n.body}</span> : null}
                        <span className="notif-bell-item-time">{fmtTime(n.created_at)}</span>
                      </span>
                      {unread ? <span className="notif-bell-item-dot" aria-hidden /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
