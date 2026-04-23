import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Plus, Link2, Trash2, KeyRound } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import type { UserRole } from '../lib/supabase'
import './Units.css'
import './UserManagement.css'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'

type AppUser = {
  id: string
  email: string
  role: string
  last_active_at: string | null
}

type UnitRow = {
  id: string
  type?: string
  number: string
  group?: { name: string } | null
}

type LinkRow = {
  id: string
  user_id: string
  unit_id: string
}

function unitLabel(u: UnitRow): string {
  const g = u.group?.name?.trim()
  const n = formatUnitNumberDisplay(u.number)
  return g ? `${g} ${n}` : n
}

const MIN_PASSWORD_LEN = 6

export default function UserManagement() {
  const {
    canEdit,
    user: authUser,
    userRole,
    refreshUserRoleById,
    setIgnoreRoleUpdateFlag,
  } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [units, setUnits] = useState<UnitRow[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [assignUser, setAssignUser] = useState<AppUser | null>(null)
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set())
  const [savingLinks, setSavingLinks] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [passwordModalUser, setPasswordModalUser] = useState<AppUser | null>(null)
  const [adminNewPassword, setAdminNewPassword] = useState('')
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('')
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const load = useCallback(async () => {
    const [uRes, unitRes, linkRes] = await Promise.all([
      supabase.from('users').select('id, email, role, last_active_at').order('email'),
      supabase.from('units').select('id, type, number, group:group_id(name)').order('type').order('number'),
      supabase.from('user_unit_links').select('id, user_id, unit_id'),
    ])
    if (uRes.error) throw uRes.error
    if (unitRes.error) throw unitRes.error
    if (linkRes.error) throw linkRes.error
    setUsers((uRes.data as AppUser[]) || [])
    setUnits(sortUnitsByTypeAndNumber((unitRes.data as unknown as UnitRow[]) || []))
    setLinks((linkRes.data as LinkRow[]) || [])
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  const linksForUser = (userId: string) => links.filter((l) => l.user_id === userId)

  const unitsSummary = (userId: string) => {
    const ids = new Set(linksForUser(userId).map((l) => l.unit_id))
    const list = units.filter((u) => ids.has(u.id)).map(unitLabel)
    return list.length ? list.join(', ') : '—'
  }

  const openAssign = (u: AppUser) => {
    const set = new Set(linksForUser(u.id).map((l) => l.unit_id))
    setAssignSelected(set)
    setAssignUser(u)
  }

  const toggleAssignUnit = (unitId: string) => {
    setAssignSelected((prev) => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  const saveAssign = async () => {
    if (!assignUser || !canEdit()) return
    setSavingLinks(true)
    try {
      const uid = assignUser.id
      const desired = assignSelected
      const current = new Set(linksForUser(uid).map((l) => l.unit_id))

      const toRemove = [...current].filter((id) => !desired.has(id))
      const toAdd = [...desired].filter((id) => !current.has(id))

      for (const unitId of toRemove) {
        const { error } = await supabase
          .from('user_unit_links')
          .delete()
          .eq('user_id', uid)
          .eq('unit_id', unitId)
        if (error) throw error
      }
      for (const unitId of toAdd) {
        const { error } = await supabase.from('user_unit_links').insert({ user_id: uid, unit_id: unitId })
        if (error) throw error
      }

      setAssignUser(null)
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Грешка при запис'
      alert(msg)
    } finally {
      setSavingLinks(false)
    }
  }

  const handleDeleteUser = async (u: AppUser) => {
    if (userRole !== 'admin') {
      alert('Само администратор може да изтрива потребители.')
      return
    }
    if (u.id === authUser?.id) {
      alert('Не можете да изтриете собствения си акаунт.')
      return
    }
    if (!confirm(`Да се изтрие потребителят „${u.email}“? Действието е необратимо.`)) return

    setDeletingId(u.id)
    try {
      const { error } = await supabase.rpc('admin_delete_user', { p_target_user_id: u.id })
      if (error) throw error
      await load()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Грешка при изтриване'
      alert(
        msg.includes('admin_delete_user') || msg.includes('function')
          ? `${msg}\n\nИзпълни миграцията database_migrations/040_admin_delete_user_rpc.sql в Supabase.`
          : msg
      )
    } finally {
      setDeletingId(null)
    }
  }

  const handleRoleChange = async (userId: string, role: UserRole) => {
    if (userRole !== 'admin') return
    if (userId === authUser?.id && role !== 'admin') {
      if (!confirm('Смяна на собствената роля от администратор? Сигурни ли сте?')) return
    }
    try {
      const { error } = await supabase.from('users').update({ role }).eq('id', userId)
      if (error) throw error
      await load()
      if (userId === authUser?.id) {
        await refreshUserRoleById(userId)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Грешка'
      alert(msg.includes('policy') ? 'Само администратор може да променя роли.' : msg)
    }
  }

  const openPasswordModal = (u: AppUser) => {
    if (userRole !== 'admin') {
      alert('Само администратор може да задава парола.')
      return
    }
    setAdminNewPassword('')
    setAdminConfirmPassword('')
    setAdminPasswordError(null)
    setPasswordModalUser(u)
  }

  const closePasswordModal = () => {
    if (savingPassword) return
    setPasswordModalUser(null)
    setAdminNewPassword('')
    setAdminConfirmPassword('')
    setAdminPasswordError(null)
  }

  const handleSaveUserPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordModalUser || userRole !== 'admin') return
    setAdminPasswordError(null)
    if (adminNewPassword.length < MIN_PASSWORD_LEN) {
      setAdminPasswordError(`Паролата трябва да е поне ${MIN_PASSWORD_LEN} символа.`)
      return
    }
    if (adminNewPassword !== adminConfirmPassword) {
      setAdminPasswordError('Паролите не съвпадат.')
      return
    }
    setSavingPassword(true)
    try {
      const { error } = await supabase.rpc('admin_set_user_password', {
        p_target_user_id: passwordModalUser.id,
        p_new_password: adminNewPassword,
      })
      if (error) throw error
      setPasswordModalUser(null)
      setAdminNewPassword('')
      setAdminConfirmPassword('')
      alert('Паролата е обновена.')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Грешка'
      setAdminPasswordError(
        msg.includes('admin_set_user_password') || msg.includes('function')
          ? `${msg}\n\nИзпълни миграцията database_migrations/052_admin_set_user_password.sql в Supabase.`
          : msg
      )
    } finally {
      setSavingPassword(false)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const email = createEmail.trim()
    const password = createPassword
    if (!email || !password) {
      alert('Въведи имейл и парола.')
      return
    }
    if (password.length < 6) {
      alert('Паролата трябва да е поне 6 символа.')
      return
    }

    setCreating(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const adminSession = sessionData?.session
      if (!adminSession) {
        throw new Error('Няма активна сесия.')
      }

      setIgnoreRoleUpdateFlag(true)

      const { data: authData, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })

      if (signErr) {
        setIgnoreRoleUpdateFlag(false)
        throw signErr
      }
      if (!authData.user) {
        setIgnoreRoleUpdateFlag(false)
        throw new Error('Потребителят не е създаден.')
      }

      await supabase.from('users').update({ email, role: 'viewer' }).eq('id', authData.user.id)

      if (authData.session) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        })
        if (sessErr) {
          setIgnoreRoleUpdateFlag(false)
          console.error(sessErr)
          alert('Акаунтът е създаден, но сесията не е възстановена — влез отново като администратор.')
          return
        }
        await new Promise((r) => setTimeout(r, 300))
        await refreshUserRoleById(adminSession.user.id)
        setIgnoreRoleUpdateFlag(false)
      } else {
        setIgnoreRoleUpdateFlag(false)
        alert(
          'Акаунтът е създаден. Ако е включено потвърждение по имейл, потребителят трябва да потвърди преди вход. Можеш да му зададеш обекти веднага.'
        )
      }

      setCreateEmail('')
      setCreatePassword('')
      await load()
    } catch (err: unknown) {
      setIgnoreRoleUpdateFlag(false)
      const msg = err instanceof Error ? err.message : 'Грешка при създаване'
      alert(msg)
    } finally {
      setCreating(false)
    }
  }

  if (!canEdit()) {
    return <div>Нямате достъп до тази страница.</div>
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="user-mgmt-page">
      <div className="page-header">
        <div>
          <h1>
            <Users size={28} className="page-header-icon" aria-hidden />
            Потребители
          </h1>
          <p>
            Входящите акаунти са отделно от обектите. За всеки потребител можеш да избереш един или повече обекти
            (апартаменти, гаражи и т.н.).
          </p>
        </div>
      </div>

      <div className="user-mgmt-card">
        <h2>Нов потребител</h2>
        <form className="user-mgmt-create-form" onSubmit={handleCreateUser}>
          <div className="form-group" style={{ maxWidth: 280 }}>
            <label htmlFor="cu-email">Имейл</label>
            <input
              id="cu-email"
              type="email"
              autoComplete="off"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              disabled={creating}
            />
          </div>
          <div className="form-group" style={{ maxWidth: 280 }}>
            <label htmlFor="cu-pass">Парола</label>
            <input
              id="cu-pass"
              type="password"
              autoComplete="new-password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              disabled={creating}
              minLength={6}
            />
          </div>
          <div className="form-group">
          <button type="submit" className="btn-primary" disabled={creating}>
            <Plus size={18} />
            {creating ? 'Създаване…' : 'Създай акаунт'}
          </button>
          </div>
        </form>
        <p className="form-hint" style={{ marginTop: '0.75rem' }}>
          Ролята по подразбиране е „Преглед“. Ролята се променя в таблицата по-долу (само администратор).
        </p>
      </div>

      <div className="user-mgmt-card">
        <h2>Списък</h2>
        <table className="user-mgmt-table">
          <thead>
            <tr>
              <th>Имейл</th>
              <th>Роля</th>
              <th>Обекти</th>
              <th>Активност</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  {userRole === 'admin' ? (
                    <select
                      className="role-select"
                      value={u.role}
                      onChange={(e) => void handleRoleChange(u.id, e.target.value as UserRole)}
                    >
                      <option value="viewer">Преглед</option>
                      <option value="editor">Редактор</option>
                      <option value="admin">Администратор</option>
                    </select>
                  ) : (
                    u.role
                  )}
                </td>
                <td className="user-mgmt-units-cell">{unitsSummary(u.id)}</td>
                <td className="user-mgmt-activity">
                  {u.last_active_at
                    ? format(new Date(u.last_active_at), 'dd.MM.yyyy HH:mm', { locale: bg })
                    : '—'}
                </td>
                <td>
                  <div className="user-mgmt-row-actions">
                    <button type="button" className="btn-secondary btn-small" onClick={() => openAssign(u)}>
                      <Link2 size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      Обекти
                    </button>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        title="Задай нова парола (без изпращане на имейл)"
                        disabled={savingPassword}
                        onClick={() => openPasswordModal(u)}
                      >
                        <KeyRound size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                        Парола
                      </button>
                    )}
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        className="btn-secondary btn-small user-mgmt-delete"
                        disabled={deletingId === u.id || u.id === authUser?.id}
                        title={u.id === authUser?.id ? 'Не можете да изтриете себе си' : 'Изтрий потребителя'}
                        onClick={() => void handleDeleteUser(u)}
                      >
                        <Trash2 size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                        {deletingId === u.id ? '…' : 'Изтрий'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {passwordModalUser && (
        <div className="modal-overlay" onClick={() => closePasswordModal()}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Нова парола</h2>
            <p className="form-hint" style={{ marginTop: 0 }}>
              За <strong>{passwordModalUser.email}</strong>. Ще може да влезе с въведената тук парола.
            </p>
            <form onSubmit={handleSaveUserPassword}>
              <div className="form-group">
                <label htmlFor="um-admin-pw1">Нова парола *</label>
                <input
                  id="um-admin-pw1"
                  type="password"
                  autoComplete="new-password"
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  disabled={savingPassword}
                  minLength={MIN_PASSWORD_LEN}
                />
              </div>
              <div className="form-group">
                <label htmlFor="um-admin-pw2">Потвърди паролата *</label>
                <input
                  id="um-admin-pw2"
                  type="password"
                  autoComplete="new-password"
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  disabled={savingPassword}
                  minLength={MIN_PASSWORD_LEN}
                />
              </div>
              {adminPasswordError && <p className="form-hint" style={{ color: 'var(--danger)', marginTop: 0 }}>{adminPasswordError}</p>}
              <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
                <button type="button" className="btn-secondary" disabled={savingPassword} onClick={closePasswordModal}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={savingPassword}>
                  {savingPassword ? 'Запис…' : 'Запази'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assignUser && (
        <div className="modal-overlay" onClick={() => !savingLinks && setAssignUser(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>Обекти за {assignUser.email}</h2>
            <p className="form-hint">Отметни всички обекти, към които този потребител има достъп.</p>
            <div className="user-mgmt-modal-units">
              {units.map((unit) => (
                <label key={unit.id}>
                  <input
                    type="checkbox"
                    checked={assignSelected.has(unit.id)}
                    onChange={() => toggleAssignUnit(unit.id)}
                  />
                  {unitLabel(unit)}
                </label>
              ))}
            </div>
            {units.length === 0 && <p className="form-hint">Няма обекти — първо добави в „Обекти“.</p>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" disabled={savingLinks} onClick={() => setAssignUser(null)}>
                Отказ
              </button>
              <button type="button" className="btn-primary" disabled={savingLinks} onClick={() => void saveAssign()}>
                {savingLinks ? 'Запис…' : 'Запази'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
