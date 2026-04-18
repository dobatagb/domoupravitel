import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Megaphone, Pin, Plus, Trash2, Edit2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Announcements.css'

interface Announcement {
  id: string
  title: string
  body: string
  pinned: boolean
  created_at: string
  created_by: string | null
}

export default function Announcements() {
  const { canEdit, user } = useAuth()
  const [rows, setRows] = useState<Announcement[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [form, setForm] = useState({ title: '', body: '', pinned: false })
  const [saving, setSaving] = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false })
      )
      if (error) {
        const msg =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: string }).message)
            : 'Грешка при зареждане'
        setLoadError(msg)
        setRows([])
        return
      }
      setRows((data as Announcement[]) || [])
    } catch (e: unknown) {
      console.error('announcements:', e)
      setLoadError(e instanceof Error ? e.message : 'Грешка при зареждане')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  const resetForm = () => {
    setForm({ title: '', body: '', pinned: false })
    setEditing(null)
    setShowForm(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    if (!form.title.trim() || !form.body.trim()) {
      alert('Попълни заглавие и текст.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('announcements')
          .update({
            title: form.title.trim(),
            body: form.body.trim(),
            pinned: form.pinned,
          })
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('announcements').insert({
          title: form.title.trim(),
          body: form.body.trim(),
          pinned: form.pinned,
          created_by: user?.id ?? null,
        })
        if (error) throw error
      }
      resetForm()
      void fetchRows()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: Announcement) => {
    if (!canEdit()) return
    if (!confirm('Изтриване на това съобщение?')) return
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', row.id)
      if (error) throw error
      void fetchRows()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка')
    }
  }

  const openEdit = (row: Announcement) => {
    setEditing(row)
    setForm({ title: row.title, body: row.body, pinned: row.pinned })
    setShowForm(true)
  }

  if (loading) {
    return <div className="announcements-page">Зареждане…</div>
  }

  return (
    <div className="announcements-page">
      {loadError && (
        <div className="announcements-error-banner" role="alert">
          <p>
            <strong>Неуспешно зареждане на съобщенията.</strong> {loadError}
          </p>
          <p className="announcements-error-hint">
            Ако таблицата е нова: изпълни в Supabase SQL миграциите{' '}
            <code>032_announcements.sql</code> и <code>033_announcements_grants_and_select.sql</code>. След това натисни
            „Опитай отново“.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void fetchRows()}>
            Опитай отново
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>
            <Megaphone size={28} className="announcements-title-icon" aria-hidden />
            Съобщения
          </h1>
          <p>Обяви към всички потребители на системата. Най-новите са отгоре; закачените остават най-отпред.</p>
        </div>
        {canEdit() && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditing(null)
              setForm({ title: '', body: '', pinned: false })
              setShowForm(true)
            }}
          >
            <Plus size={20} />
            Ново съобщение
          </button>
        )}
      </div>

      {showForm && canEdit() && (
        <div className="announcements-form-card">
          <h2>{editing ? 'Редактирай съобщение' : 'Ново съобщение'}</h2>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <div className="form-group">
              <label htmlFor="ann-title">Заглавие *</label>
              <input
                id="ann-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="ann-body">Текст *</label>
              <textarea
                id="ann-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>
            <label className="announcements-pin-label">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              />
              Закачи най-отгоре
            </label>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => resetForm()}>
                Отказ
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Запис…' : 'Запази'}
              </button>
            </div>
          </form>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="announcements-empty">Все още няма съобщения.</p>
      ) : (
        <ul className="announcements-list">
          {rows.map((row) => (
            <li key={row.id} className={`announcements-item ${row.pinned ? 'pinned' : ''}`}>
              <div className="announcements-item-head">
                {row.pinned && (
                  <span className="announcements-pinned-badge" title="Закачено">
                    <Pin size={16} aria-hidden />
                    Важно
                  </span>
                )}
                <h2>{row.title}</h2>
                <time dateTime={row.created_at}>
                  {format(new Date(row.created_at), 'd MMMM yyyy, HH:mm', { locale: bg })}
                </time>
              </div>
              <div className="announcements-body">{row.body}</div>
              {canEdit() && (
                <div className="announcements-item-actions">
                  <button type="button" className="icon-btn" onClick={() => openEdit(row)} title="Редактирай">
                    <Edit2 size={18} />
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => void handleDelete(row)} title="Изтрий">
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
