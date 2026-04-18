import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Tags, Trash2 } from 'lucide-react'
import type { UnitGroup } from '../types/unitGroup'
import './Units.css'
import './Nomenclatures.css'

type Draft = {
  name: string
  list_label_short: string
}

type CreateDraft = Draft & {
  code: string
}

function toDraft(g: UnitGroup): Draft {
  return {
    name: g.name,
    list_label_short: g.list_label_short ?? '',
  }
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

/** PostgREST/Postgres: липсваща колона в схемата (често при неприложена миграция за list_label_short). */
function isUnknownColumnOrSchemaError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const m = (err.message || '').toLowerCase()
  return (
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    (m.includes('column') && (m.includes('does not exist') || m.includes('could not find'))) ||
    m.includes('schema cache')
  )
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const m = err.message || ''
  return err.code === '23505' || /duplicate key|unique constraint/i.test(m)
}

function emptyCreateDraft(): CreateDraft {
  return {
    code: '',
    name: '',
    list_label_short: '',
  }
}

export default function Nomenclatures() {
  const { canEdit } = useAuth()
  const [groups, setGroups] = useState<UnitGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => emptyCreateDraft())
  const [creating, setCreating] = useState(false)

  const fetchGroups = async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase.from('unit_groups').select('*').order('name', { ascending: true })
    )
    if (error) throw error
    setGroups((data as UnitGroup[]) || [])
  }

  useEffect(() => {
    void (async () => {
      try {
        await fetchGroups()
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const openCreateModal = () => {
    setCreateDraft(emptyCreateDraft())
    setShowCreateModal(true)
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const code = createDraft.code.trim().toLowerCase().replace(/\s+/g, '_')
    if (!CODE_PATTERN.test(code)) {
      alert(
        'Кодът трябва да започва с латинска буква и да съдържа само малки букви, цифри и _ (напр. storage_unit).'
      )
      return
    }
    if (!createDraft.name.trim()) {
      alert('Въведи име на групата.')
      return
    }
    setCreating(true)
    try {
      const fullRow = {
        code,
        name: createDraft.name.trim(),
        list_label_short: createDraft.list_label_short.trim() || null,
      }
      const minimalRow = {
        code,
        name: createDraft.name.trim(),
      }

      let { error } = await supabase.from('unit_groups').insert(fullRow)

      if (error) {
        if (isUniqueViolation(error)) {
          alert('Кодът вече съществува.')
          return
        }
        if (isUnknownColumnOrSchemaError(error)) {
          const second = await supabase.from('unit_groups').insert(minimalRow)
          error = second.error
          if (!error) {
            alert(
              'Групата е създадена с основни полета. За кратък етикет изпълни миграциите за `unit_groups` (колона list_label_short), после редактирай групата.'
            )
          }
        }
      }

      if (error) {
        if (isUniqueViolation(error)) {
          alert('Кодът вече съществува.')
          return
        }
        console.error('unit_groups insert:', error)
        alert(
          error.message ||
            'Грешка при запис. Провери дали си логнат като admin/editor и дали миграциите за `unit_groups` са приложени.'
        )
        return
      }

      setShowCreateModal(false)
      await fetchGroups()
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (g: UnitGroup) => {
    if (!canEdit()) return
    if (
      !confirm(
        `Изтриване на група „${g.name}“ (код: ${g.code})?\n\nВъзможно е само ако няма обекти и няма такси, вързани към тази група.`
      )
    ) {
      return
    }
    setSavingId(`del-${g.id}`)
    try {
      const { count, error: cErr } = await supabase
        .from('units')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id)
      if (cErr) throw cErr
      if (count != null && count > 0) {
        alert(`Има ${count} обекта с тази група. Първо ги прехвърли на друга група или ги изтрий.`)
        return
      }
      const { error } = await supabase.from('unit_groups').delete().eq('id', g.id)
      if (error) throw error
      await fetchGroups()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при изтриване'
      alert(
        msg.includes('foreign key') || msg.includes('violates')
          ? 'Не може да се изтрие: има свързани записи (напр. такси).'
          : msg
      )
    } finally {
      setSavingId(null)
    }
  }

  const startEdit = (g: UnitGroup) => {
    setDrafts((d) => ({ ...d, [g.id]: toDraft(g) }))
  }

  const cancelEdit = (id: string) => {
    setDrafts((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
  }

  const saveGroup = async (id: string) => {
    const draft = drafts[id]
    if (!draft || !canEdit()) return
    setSavingId(id)
    try {
      const { error } = await supabase
        .from('unit_groups')
        .update({
          name: draft.name.trim(),
          list_label_short: draft.list_label_short.trim() || null,
        })
        .eq('id', id)
      if (error) throw error
      cancelEdit(id)
      await fetchGroups()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Грешка при запис'
      alert(msg)
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="nomenclatures-page">
      <div className="page-header nomenclatures-header">
        <div>
          <h1>
            <Tags size={28} className="page-header-icon" aria-hidden />
            Номенклатури
          </h1>
          <p>
            Групи обекти — пълен CRUD. Месечните суми по група се задават в „Периоди“. Кодът при нова група е уникален
            идентификатор (латиница).
          </p>
        </div>
        {canEdit() && (
          <button type="button" className="btn-primary" onClick={openCreateModal}>
            <Plus size={20} />
            Нова група
          </button>
        )}
      </div>

      <div className="nomenclatures-card">
        {groups.length === 0 ? (
          <div className="nomenclatures-empty">Няма дефинирани групи. Добави първата с „Нова група“.</div>
        ) : (
          <table className="nomenclatures-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Име</th>
                <th>Кратко</th>
                {canEdit() && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const draft = drafts[g.id]
                const editing = !!draft
                return (
                  <tr key={g.id}>
                    <td>
                      <code className="code-cell">{g.code}</code>
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="nom-input"
                          value={draft.name}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [g.id]: { ...draft, name: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        g.name
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          className="nom-input nom-input-short"
                          value={draft.list_label_short}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [g.id]: { ...draft, list_label_short: e.target.value },
                            }))
                          }
                          placeholder="за таблици"
                        />
                      ) : (
                        g.list_label_short ?? '—'
                      )}
                    </td>
                    {canEdit() && (
                      <td className="actions-cell">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className="btn-primary btn-small"
                              disabled={savingId === g.id}
                              onClick={() => void saveGroup(g.id)}
                            >
                              {savingId === g.id ? '…' : 'Запази'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              disabled={savingId === g.id}
                              onClick={() => cancelEdit(g.id)}
                            >
                              Отказ
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              onClick={() => startEdit(g)}
                              disabled={savingId != null}
                            >
                              Редактирай
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              title="Изтрий група"
                              disabled={savingId != null}
                              onClick={() => void handleDelete(g)}
                              aria-label="Изтрий"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Нова група обекти</h2>
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label htmlFor="ng-code">Код *</label>
                <input
                  id="ng-code"
                  value={createDraft.code}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, code: e.target.value }))}
                  placeholder="напр. storage, office"
                  required
                  autoComplete="off"
                  disabled={creating}
                />
                <small className="form-hint">Латиница, малки букви, цифри и _. Не се променя след създаване.</small>
              </div>
              <div className="form-group">
                <label htmlFor="ng-name">Име *</label>
                <input
                  id="ng-name"
                  value={createDraft.name}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Видимо име в списъци"
                  required
                  disabled={creating}
                />
              </div>
              <div className="form-group">
                <label htmlFor="ng-short">Кратък етикет</label>
                <input
                  id="ng-short"
                  value={createDraft.list_label_short}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, list_label_short: e.target.value }))}
                  placeholder="за тесни таблици"
                  disabled={creating}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" disabled={creating} onClick={() => setShowCreateModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Запис…' : 'Създай'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
