import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, Filter } from 'lucide-react'
import { useUnitGroups } from '../hooks/useUnitGroups'
import type { UnitGroup } from '../types/unitGroup'
import './Units.css'

interface Unit {
  id: string
  group_id: string
  type: string
  number: string
  area: number
  owner_name: string
  owner_email: string | null
  owner_phone: string | null
  tenant_name: string | null
  tenant_email: string | null
  tenant_phone: string | null
  notes: string | null
  opening_balance?: number | string | null
  created_at: string
  group?: UnitGroup | null
}

const unitSelectFields = `
          *,
          group:group_id (*)
        `

export default function Units() {
  const { canEdit } = useAuth()
  const { groups, loading: groupsLoading, labelForCode } = useUnitGroups()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [filterGroupId, setFilterGroupId] = useState<string | 'all'>('all')
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
    opening_balance: '0',
  })

  useEffect(() => {
    void loadData()
  }, [])

  const pageLoading = loading || groupsLoading

  const loadData = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('units')
          .select(unitSelectFields)
          .order('type', { ascending: true })
          .order('number', { ascending: true })
      )
      if (error) throw error
      setUnits(data || [])
    } catch (error) {
      console.error('Error loading units:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('units')
          .select(unitSelectFields)
          .order('type', { ascending: true })
          .order('number', { ascending: true })
      )
      if (error) throw error
      setUnits(data || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const selectedGroup = groups.find((g) => g.id === formData.group_id)
      if (!selectedGroup) {
        alert('Изберете група обект.')
        return
      }

      const obRaw = formData.opening_balance.trim().replace(',', '.')
      const openingBalance = obRaw === '' ? 0 : parseFloat(obRaw)
      if (Number.isNaN(openingBalance) || openingBalance < 0) {
        alert('Пренесеният дълг трябва да е число ≥ 0.')
        return
      }

      const unitData: Record<string, unknown> = {
        group_id: formData.group_id,
        type: selectedGroup.code,
        number: formData.number,
        area: parseFloat(formData.area),
        owner_name: formData.owner_name,
        owner_email: formData.owner_email || null,
        owner_phone: formData.owner_phone || null,
        tenant_name: formData.tenant_name || null,
        tenant_email: formData.tenant_email || null,
        tenant_phone: formData.tenant_phone || null,
        notes: formData.notes || null,
        opening_balance: openingBalance,
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
    setEditingUnit(unit)
    setFormData({
      group_id: unit.group_id,
      number: unit.number,
      area: unit.area.toString(),
      owner_name: unit.owner_name,
      owner_email: unit.owner_email || '',
      owner_phone: unit.owner_phone || '',
      tenant_name: unit.tenant_name || '',
      tenant_email: unit.tenant_email || '',
      tenant_phone: unit.tenant_phone || '',
      notes: unit.notes || '',
      opening_balance:
        unit.opening_balance != null && unit.opening_balance !== ''
          ? String(unit.opening_balance)
          : '0',
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази единица?')) return

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
      opening_balance: '0',
    })
  }

  const openNewModal = () => {
    setEditingUnit(null)
    resetForm()
    setShowModal(true)
  }

  const filteredUnits =
    filterGroupId === 'all' ? units : units.filter((unit) => unit.group_id === filterGroupId)

  if (pageLoading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="units-page">
      <div className="page-header">
        <div>
          <h1>Единици</h1>
          <p>Управление на апартаменти, гаражи, магазини и паркоместа</p>
        </div>
        {canEdit() && (
          <button className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави единица
          </button>
        )}
      </div>

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
          Показване: {filteredUnits.length} от {units.length} единици
        </div>
      </div>

      <div className="units-grid">
        {filteredUnits.length === 0 ? (
          <div className="empty-state">Няма регистрирани единици</div>
        ) : (
          filteredUnits.map((unit) => {
            const openingBal =
              unit.opening_balance != null && unit.opening_balance !== ''
                ? Number(unit.opening_balance)
                : 0
            return (
            <div key={unit.id} className="unit-card">
              <div className="unit-header">
                <div>
                  <h3>
                    {unit.group?.name ?? labelForCode(unit.type)} {unit.number}
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
                  <span className="detail-label">Площ:</span>
                  <span className="detail-value">{unit.area} м²</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Собственик:</span>
                  <span className="detail-value">{unit.owner_name}</span>
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

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUnit ? 'Редактирай единица' : 'Добави единица'}</h2>
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
                <label>Площ (м²) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.area}
                  onChange={(e) =>
                    setFormData({ ...formData, area: e.target.value })
                  }
                  required
                  min="0.01"
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

              <div className="form-section">
                <h3>Задължения</h3>
                <div className="form-group">
                  <label>Пренесен дълг (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.opening_balance}
                    onChange={(e) =>
                      setFormData({ ...formData, opening_balance: e.target.value })
                    }
                    placeholder="0"
                  />
                  <small className="form-hint">
                    Сума, която едницата дължи извън текущото таксуване по периоди (напр. стари задължения). Намаляваш
                    ръчно, когато погасиш част от нея.
                  </small>
                </div>
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
