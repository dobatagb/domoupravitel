import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, Filter } from 'lucide-react'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'
import type { UnitGroup } from '../types/unitGroup'
import './Units.css'

interface Unit {
  id: string
  group_id: string
  type: string
  number: string
  area?: number
  owner_name?: string
  owner_email: string | null
  owner_phone: string | null
  tenant_name: string | null
  tenant_email: string | null
  tenant_phone: string | null
  notes: string | null
  floor?: string | null
  opening_balance?: number | string | null
  created_at: string
  group?: UnitGroup | null
}

const unitSelectFields = `
          *,
          group:group_id (*)
        `

function formatMoneyBg(n: number): string {
  return `${n.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

export default function Units() {
  const { canEdit, userRole, user } = useAuth()
  const isViewer = userRole === 'viewer'
  const { groups, loading: groupsLoading, labelForCode } = useUnitGroups()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [filterGroupId, setFilterGroupId] = useState<string | 'all'>('all')
  /** За viewer: редове задължения с остатък по unit_id. */
  const [viewerDueLines, setViewerDueLines] = useState<Record<string, { title: string; rem: number }[]>>({})
  const [formData, setFormData] = useState({
    group_id: '',
    number: '',
    area: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    tenant_name: '',
    tenant_email: '',
    tenant_phone: '',
    notes: '',
    floor: '',
  })

  useEffect(() => {
    void loadData()
  }, [user?.id, userRole])

  const pageLoading = loading || groupsLoading

  const loadData = async () => {
    setLoading(true)
    try {
      if (isViewer) {
        if (!user?.id) {
          setUnits([])
          setViewerDueLines({})
          return
        }
        const { data: links, error: linkErr } = await supabase
          .from('user_unit_links')
          .select('unit_id')
          .eq('user_id', user.id)
        if (linkErr) throw linkErr
        const ids = (links || []).map((r: { unit_id: string }) => r.unit_id)
        if (ids.length === 0) {
          setUnits([])
          setViewerDueLines({})
          return
        }
        const { data, error } = await supabase
          .from('units')
          .select('id, group_id, type, number, floor, opening_balance, group:group_id (*)')
          .in('id', ids)
        if (error) throw error
        const list = sortUnitsByTypeAndNumber((data as Unit[]) || [])
        setUnits(list)
        const { data: obl, error: oblErr } = await supabase
          .from('unit_obligations')
          .select('unit_id, title, amount_remaining')
          .in('unit_id', ids)
          .gt('amount_remaining', 0.005)
        if (!oblErr && obl) {
          const m: Record<string, { title: string; rem: number }[]> = {}
          for (const raw of obl) {
            const r = raw as { unit_id: string; title: string; amount_remaining: number | string }
            const rem = typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
            if (!Number.isFinite(rem) || rem <= 0) continue
            if (!m[r.unit_id]) m[r.unit_id] = []
            m[r.unit_id].push({ title: r.title || 'Задължение', rem })
          }
          setViewerDueLines(m)
        } else {
          setViewerDueLines({})
        }
        return
      }

      const { data, error } = await supabase
        .from('units')
        .select(unitSelectFields)
        .order('type', { ascending: true })
        .order('number', { ascending: true })
      if (error) throw error
      setUnits((data as Unit[]) || [])
    } catch (error) {
      console.error('Error loading units:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      if (isViewer) {
        if (!user?.id) {
          setUnits([])
          setViewerDueLines({})
          return
        }
        const { data: links } = await supabase
          .from('user_unit_links')
          .select('unit_id')
          .eq('user_id', user.id)
        const ids = (links || []).map((r: { unit_id: string }) => r.unit_id)
        if (ids.length === 0) {
          setUnits([])
          setViewerDueLines({})
          return
        }
        const { data, error } = await supabase
          .from('units')
          .select('id, group_id, type, number, floor, opening_balance, group:group_id (*)')
          .in('id', ids)
        if (error) throw error
        const list = sortUnitsByTypeAndNumber((data as Unit[]) || [])
        setUnits(list)
        const { data: obl, error: oblErr } = await supabase
          .from('unit_obligations')
          .select('unit_id, title, amount_remaining')
          .in('unit_id', ids)
          .gt('amount_remaining', 0.005)
        if (!oblErr && obl) {
          const m: Record<string, { title: string; rem: number }[]> = {}
          for (const raw of obl) {
            const r = raw as { unit_id: string; title: string; amount_remaining: number | string }
            const rem = typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
            if (!Number.isFinite(rem) || rem <= 0) continue
            if (!m[r.unit_id]) m[r.unit_id] = []
            m[r.unit_id].push({ title: r.title || 'Задължение', rem })
          }
          setViewerDueLines(m)
        } else {
          setViewerDueLines({})
        }
        return
      }
      const { data, error } = await supabase
        .from('units')
        .select(unitSelectFields)
        .order('type', { ascending: true })
        .order('number', { ascending: true })
      if (error) throw error
      setUnits((data as Unit[]) || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isViewer) return
    try {
      const selectedGroup = groups.find((g) => g.id === formData.group_id)
      if (!selectedGroup) {
        alert('Изберете група обект.')
        return
      }

      const areaRaw = formData.area.trim().replace(',', '.')
      const area = parseFloat(areaRaw)
      if (Number.isNaN(area) || area <= 0) {
        alert('Квадратурата трябва да е положително число (напр. 65 или 65,5).')
        return
      }

      const unitData: Record<string, unknown> = {
        group_id: formData.group_id,
        type: selectedGroup.code,
        number: formData.number,
        area,
        owner_name: formData.owner_name,
        owner_email: formData.owner_email || null,
        owner_phone: formData.owner_phone || null,
        tenant_name: formData.tenant_name || null,
        tenant_email: formData.tenant_email || null,
        tenant_phone: formData.tenant_phone || null,
        notes: formData.notes || null,
        floor: formData.floor.trim() || null,
      }

      if (editingUnit) {
        const { error } = await supabase
          .from('units')
          .update(unitData)
          .eq('id', editingUnit.id)

        if (error) {
          console.error('Error updating unit:', error)
          throw error
        }
      } else {
        const { error } = await supabase.from('units').insert(unitData)

        if (error) {
          console.error('Error inserting unit:', error)
          console.error('Unit data:', unitData)
          throw error
        }
      }

      setShowModal(false)
      setEditingUnit(null)
      resetForm()
      fetchUnits()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при запазване'
      alert(msg)
    }
  }

  const handleEdit = (unit: Unit) => {
    if (isViewer) return
    setEditingUnit(unit)
    setFormData({
      group_id: unit.group_id,
      number: unit.number,
      area: String(unit.area ?? ''),
      owner_name: unit.owner_name ?? '',
      owner_email: unit.owner_email || '',
      owner_phone: unit.owner_phone || '',
      tenant_name: unit.tenant_name || '',
      tenant_email: unit.tenant_email || '',
      tenant_phone: unit.tenant_phone || '',
      notes: unit.notes || '',
      floor: unit.floor ?? '',
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този обект?')) return

    try {
      const { error } = await supabase.from('units').delete().eq('id', id)
      if (error) throw error
      fetchUnits()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при изтриване'
      alert(msg)
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name, 'bg'))

  const resetForm = () => {
    const defaultGroupId = sortedGroups[0]?.id ?? ''
    setFormData({
      group_id: defaultGroupId,
      number: '',
      area: '',
      owner_name: '',
      owner_email: '',
      owner_phone: '',
      tenant_name: '',
      tenant_email: '',
      tenant_phone: '',
      notes: '',
      floor: '',
    })
  }

  const openNewModal = () => {
    setEditingUnit(null)
    resetForm()
    setShowModal(true)
  }

  const filteredUnits = isViewer
    ? units
    : filterGroupId === 'all'
      ? units
      : units.filter((unit) => unit.group_id === filterGroupId)

  if (pageLoading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="units-page">
      <div className="page-header">
        <div>
          <h1>{isViewer ? 'Мои обекти' : 'Обекти'}</h1>
          <p>
            {isViewer
              ? 'Преглед по номер и етаж. Данните за обектите въвежда домоуправителят; по-долу са текущите задължения с остатък (заглавията са като в „Задължения“ и „Периоди“).'
              : 'Управление на апартаменти, гаражи, магазини и паркоместа'}
          </p>
          {canEdit() && (
            <p className="units-page-subhint">
              Пренесен дълг (старо задължение) се въвежда от{' '}
              <Link to="/obligations">Задължения</Link> — бутон „Пренесен дълг по обект“.
            </p>
          )}
        </div>
        {canEdit() && (
          <button className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави обект
          </button>
        )}
      </div>

      {!isViewer && (
        <div className="filter-section">
          <div className="filter-group">
            <Filter size={18} />
            <select
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value as string | 'all')}
              className="filter-select"
            >
              <option value="all">Всички групи</option>
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="units-count">
            Показване: {filteredUnits.length} от {units.length} обекта
          </div>
        </div>
      )}

      <div className="units-grid">
        {filteredUnits.length === 0 ? (
          <div className="empty-state">
            {isViewer
              ? 'Няма свързани обекти към вашия акаунт. Помолете домоуправителя да ви добави към вашия апартамент / обект.'
              : 'Няма регистрирани обекти'}
          </div>
        ) : (
          sortUnitsByTypeAndNumber(filteredUnits).map((unit) => {
            if (isViewer) {
              const lines = viewerDueLines[unit.id]
              return (
                <div key={unit.id} className="unit-card unit-card-viewer">
                  <div className="unit-header">
                    <h3>
                      Ап. {formatUnitNumberDisplay(unit.number)}
                      {unit.group?.name ? (
                        <span className="unit-card-viewer-group"> · {unit.group.name}</span>
                      ) : null}
                    </h3>
                  </div>
                  <div className="unit-details">
                    {unit.floor?.trim() && (
                      <div className="detail-item">
                        <span className="detail-label">Етаж:</span>
                        <span className="detail-value">{unit.floor}</span>
                      </div>
                    )}
                    <div className="viewer-due-section">
                      <div className="detail-label" style={{ marginBottom: '0.35rem' }}>
                        Текущи задължения (остатък)
                      </div>
                      {lines && lines.length > 0 ? (
                        <ul className="viewer-due-list">
                          {lines.map((line, i) => (
                            <li key={`${line.title}-${i}`}>
                              <span className="viewer-due-title">{line.title}</span>
                              <span className="viewer-due-amt">{formatMoneyBg(line.rem)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="form-hint" style={{ margin: 0 }}>
                          Няма остатък по задължения към момента.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            }
            const openingBal =
              unit.opening_balance != null && unit.opening_balance !== ''
                ? Number(unit.opening_balance)
                : 0
            return (
              <div key={unit.id} className="unit-card">
                <div className="unit-header">
                  <div>
                    <h3>
                      {unit.group?.name ?? labelForCode(unit.type)} {formatUnitNumberDisplay(unit.number)}
                    </h3>
                  </div>
                  {canEdit() && (
                    <div className="unit-actions">
                      <button
                        className="icon-btn"
                        onClick={() => handleEdit(unit)}
                        title="Редактирай"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => handleDelete(unit.id)}
                        title="Изтрий"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="unit-details">
                  <div className="detail-item">
                    <span className="detail-label">Квадратура:</span>
                    <span className="detail-value">{unit.area ?? '—'} м²</span>
                  </div>
                  {unit.floor?.trim() && (
                    <div className="detail-item">
                      <span className="detail-label">Етаж:</span>
                      <span className="detail-value">{unit.floor}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">Собственик:</span>
                    <span className="detail-value">{unit.owner_name ?? '—'}</span>
                  </div>
                  {unit.owner_email && (
                    <div className="detail-item">
                      <span className="detail-label">Имейл:</span>
                      <span className="detail-value">{unit.owner_email}</span>
                    </div>
                  )}
                  {unit.owner_phone && (
                    <div className="detail-item">
                      <span className="detail-label">Телефон:</span>
                      <span className="detail-value">{unit.owner_phone}</span>
                    </div>
                  )}
                  {unit.tenant_name && (
                    <div className="detail-item tenant">
                      <span className="detail-label">Наемател:</span>
                      <span className="detail-value">{unit.tenant_name}</span>
                    </div>
                  )}
                  {unit.tenant_email && (
                    <div className="detail-item tenant">
                      <span className="detail-label">Имейл (наемател):</span>
                      <span className="detail-value">{unit.tenant_email}</span>
                    </div>
                  )}
                  {openingBal > 0 && (
                    <div className="detail-item">
                      <span className="detail-label">Пренесен дълг:</span>
                      <span className="detail-value">{openingBal.toFixed(2)} €</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {showModal && canEdit() && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUnit ? 'Редактирай обект' : 'Добави обект'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Група обект *</label>
                <select
                  value={formData.group_id}
                  onChange={(e) => {
                    setFormData({ ...formData, group_id: e.target.value })
                  }}
                  required
                >
                  <option value="">Изберете…</option>
                  {sortedGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Номер *</label>
                <input
                  type="text"
                  value={formData.number}
                  onChange={(e) =>
                    setFormData({ ...formData, number: e.target.value })
                  }
                  required
                  placeholder="Напр. 5, 12, A1"
                />
              </div>

              <div className="form-group">
                <label>Квадратура (м²) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.area}
                  onChange={(e) =>
                    setFormData({ ...formData, area: e.target.value })
                  }
                  required
                  min="0.01"
                  placeholder="Напр. 65,5"
                />
              </div>

              <div className="form-group">
                <label>Етаж</label>
                <input
                  type="text"
                  value={formData.floor}
                  onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                  placeholder="Напр. 5, партер, мансарда"
                />
              </div>

              <div className="form-section">
                <h3>Собственик</h3>
                <div className="form-group">
                  <label>Име на собственик *</label>
                  <input
                    type="text"
                    value={formData.owner_name}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Имейл на собственик</label>
                  <input
                    type="email"
                    value={formData.owner_email}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Телефон на собственик</label>
                  <input
                    type="tel"
                    value={formData.owner_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_phone: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-section">
                <h3>Наемател (опционално)</h3>
                <div className="form-group">
                  <label>Име на наемател</label>
                  <input
                    type="text"
                    value={formData.tenant_name}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_name: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Имейл на наемател</label>
                  <input
                    type="email"
                    value={formData.tenant_email}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Телефон на наемател</label>
                  <input
                    type="tel"
                    value={formData.tenant_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_phone: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Бележки</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Отказ
                </button>
                <button type="submit" className="btn-primary">
                  Запази
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
