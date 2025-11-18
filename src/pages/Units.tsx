import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, Filter } from 'lucide-react'
import './Units.css'

type UnitType = 'apartment' | 'garage' | 'shop' | 'parking'

interface Unit {
  id: string
  type: UnitType
  number: string
  floor: number | null
  area: number
  owner_name: string
  owner_email: string | null
  owner_phone: string | null
  tenant_name: string | null
  tenant_email: string | null
  tenant_phone: string | null
  linked_unit_id: string | null
  notes: string | null
  created_at: string
  linked_unit?: { type: UnitType; number: string }
}

const unitTypeLabels: Record<UnitType, string> = {
  apartment: 'Апартамент',
  garage: 'Гараж',
  shop: 'Магазин',
  parking: 'Паркомясто',
}

export default function Units() {
  const { canEdit, refreshUserRoleById, setIgnoreRoleUpdateFlag } = useAuth()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [filterType, setFilterType] = useState<UnitType | 'all'>('all')
  const [formData, setFormData] = useState({
    type: 'apartment' as UnitType,
    number: '',
    floor: '',
    area: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    tenant_name: '',
    tenant_email: '',
    tenant_phone: '',
    linked_unit_id: '',
    notes: '',
    user_email: '',
    user_password: '',
  })

  useEffect(() => {
    fetchUnits()
  }, [])

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabase
        .from('units')
        .select(`
          *,
          linked_unit:linked_unit_id (type, number)
        `)
        .order('type', { ascending: true })
        .order('number', { ascending: true })

      if (error) throw error
      setUnits(data || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      let userId: string | null = null

      // Ако се добавя нова единица и има email/password, създаваме user
      if (!editingUnit && formData.user_email && formData.user_password) {
        try {
          // Запазване на текущата сесия на администратора ПРЕДИ signUp
          const { data: currentSession } = await supabase.auth.getSession()
          const adminSession = currentSession?.session
          
          if (!adminSession) {
            throw new Error('Няма активна сесия на администратор')
          }

          // Активиране на флаг за игнориране на обновяване на ролята
          // Това предотвратява onAuthStateChange да обнови ролята на viewer
          setIgnoreRoleUpdateFlag(true)

          // Създаване на потребител чрез обикновена регистрация
          // signUp автоматично логва новия потребител, затова трябва веднага да се върнем
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: formData.user_email,
            password: formData.user_password,
            options: {
              emailRedirectTo: window.location.origin,
            },
          })

          if (authError) {
            setIgnoreRoleUpdateFlag(false)
            throw authError
          }
          if (!authData.user) {
            setIgnoreRoleUpdateFlag(false)
            throw new Error('Неуспешно създаване на потребител')
          }

          userId = authData.user.id

          // Обновяване на ролята в users таблицата (trigger създава viewer по подразбиране)
          const { error: userError } = await supabase
            .from('users')
            .update({ role: 'viewer', email: formData.user_email })
            .eq('id', userId)

          if (userError) {
            console.warn('Error updating user role:', userError)
          }

          // ВЕДНАГА връщане към сесията на администратора БЕЗ забавяне
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          })

          if (setSessionError) {
            setIgnoreRoleUpdateFlag(false)
            console.error('Error restoring admin session:', setSessionError)
            await supabase.auth.signOut()
            alert('Единицата е създадена успешно, но трябва да влезете отново като администратор.')
            window.location.reload()
            return
          }

          // Възстановяване на ролята на администратора
          // Изчакваме малко за да се обнови сесията преди да обновим ролята
          await new Promise(resolve => setTimeout(resolve, 300))
          
          // Проверяваме дали сесията е на администратора
          const { data: restoredSession } = await supabase.auth.getSession()
          if (restoredSession?.session?.user?.id === adminSession.user.id) {
            // Сесията е на администратора - обновяваме ролята ДИРЕКТНО
            // Вземаме ролята директно от базата данни за да избегнем проблеми с state-а
            const { data: roleData } = await supabase
              .from('users')
              .select('role')
              .eq('id', adminSession.user.id)
              .maybeSingle()
            
            if (roleData?.role === 'admin') {
              // Обновяваме ролята директно чрез refreshUserRoleById
              // Тази функция не задава default 'viewer', така че няма проблем
              await refreshUserRoleById(adminSession.user.id)
              
              // Изчакваме малко за да се обнови ролята в state-а
              await new Promise(resolve => setTimeout(resolve, 300))
              
              // СЕГА деактивираме флага - след като ролята е обновена
              setIgnoreRoleUpdateFlag(false)
            } else {
              console.warn('Admin role not found or incorrect, role:', roleData?.role)
              // Все пак опитваме се да обновим ролята
              await refreshUserRoleById(adminSession.user.id)
              await new Promise(resolve => setTimeout(resolve, 300))
              setIgnoreRoleUpdateFlag(false)
            }
          } else {
            console.warn('Session not restored to admin, forcing refresh')
            // Ако не, опитваме се отново
            await supabase.auth.setSession({
              access_token: adminSession.access_token,
              refresh_token: adminSession.refresh_token,
            })
            await new Promise(resolve => setTimeout(resolve, 300))
            
            // Обновяваме ролята преди да деактивираме флага
            await refreshUserRoleById(adminSession.user.id)
            await new Promise(resolve => setTimeout(resolve, 500))
            setIgnoreRoleUpdateFlag(false)
          }
        } catch (userCreationError: any) {
          // Ако създаването на потребител не успее, все пак създаваме единицата
          console.error('Error creating user:', userCreationError)
          alert(`Единицата е създадена, но създаването на потребителски акаунт не бе успешно: ${userCreationError.message}`)
        }
      }

      const unitData: any = {
        type: formData.type,
        number: formData.number,
        area: parseFloat(formData.area),
        owner_name: formData.owner_name,
        owner_email: formData.owner_email || null,
        owner_phone: formData.owner_phone || null,
        tenant_name: formData.tenant_name || null,
        tenant_email: formData.tenant_email || null,
        tenant_phone: formData.tenant_phone || null,
        linked_unit_id: formData.linked_unit_id || null,
        notes: formData.notes || null,
      }

      // Добавяме user_id само ако е създаден нов потребител
      if (userId) {
        unitData.user_id = userId
      }

      // Добавяме floor само за апартаменти
      if (formData.type === 'apartment' && formData.floor) {
        unitData.floor = parseInt(formData.floor)
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
    } catch (error: any) {
      alert(error.message || 'Грешка при запазване')
    }
  }

  const handleEdit = (unit: Unit) => {
    setEditingUnit(unit)
    setFormData({
      type: unit.type,
      number: unit.number,
      floor: unit.floor?.toString() || '',
      area: unit.area.toString(),
      owner_name: unit.owner_name,
      owner_email: unit.owner_email || '',
      owner_phone: unit.owner_phone || '',
      tenant_name: unit.tenant_name || '',
      tenant_email: unit.tenant_email || '',
      tenant_phone: unit.tenant_phone || '',
      linked_unit_id: unit.linked_unit_id || '',
      notes: unit.notes || '',
      user_email: '',
      user_password: '',
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази единица?')) return

    try {
      const { error } = await supabase.from('units').delete().eq('id', id)
      if (error) throw error
      fetchUnits()
    } catch (error: any) {
      alert(error.message || 'Грешка при изтриване')
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'apartment',
      number: '',
      floor: '',
      area: '',
      owner_name: '',
      owner_email: '',
      owner_phone: '',
      tenant_name: '',
      tenant_email: '',
      tenant_phone: '',
      linked_unit_id: '',
      notes: '',
      user_email: '',
      user_password: '',
    })
  }

  const openNewModal = () => {
    setEditingUnit(null)
    resetForm()
    setShowModal(true)
  }

  const filteredUnits = filterType === 'all' 
    ? units 
    : units.filter(unit => unit.type === filterType)

  // Вземане на единици за свързване (само апартаменти за паркоместа и гаражи)
  const getLinkableUnits = () => {
    if (formData.type === 'parking' || formData.type === 'garage') {
      return units.filter(u => u.type === 'apartment')
    }
    return []
  }

  if (loading) {
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
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as UnitType | 'all')}
            className="filter-select"
          >
            <option value="all">Всички типове</option>
            <option value="apartment">Апартаменти</option>
            <option value="garage">Гаражи</option>
            <option value="shop">Магазини</option>
            <option value="parking">Паркоместа</option>
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
          filteredUnits.map((unit) => (
            <div key={unit.id} className="unit-card">
              <div className="unit-header">
                <div>
                  <h3>
                    {unitTypeLabels[unit.type]} {unit.number}
                    {unit.type === 'apartment' && unit.floor && ` (Етаж ${unit.floor})`}
                  </h3>
                  {unit.linked_unit && (
                    <div className="linked-unit-badge">
                      Свързано с: {unitTypeLabels[unit.linked_unit.type]} {unit.linked_unit.number}
                    </div>
                  )}
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
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUnit ? 'Редактирай единица' : 'Добави единица'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Тип единица *</label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    setFormData({ ...formData, type: e.target.value as UnitType, floor: '' })
                  }}
                  required
                  disabled={!!editingUnit}
                >
                  <option value="apartment">Апартамент</option>
                  <option value="garage">Гараж</option>
                  <option value="shop">Магазин</option>
                  <option value="parking">Паркомясто</option>
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

              {formData.type === 'apartment' && (
                <div className="form-group">
                  <label>Етаж</label>
                  <input
                    type="number"
                    value={formData.floor}
                    onChange={(e) =>
                      setFormData({ ...formData, floor: e.target.value })
                    }
                    placeholder="Напр. 1, 2, 3"
                  />
                </div>
              )}

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

              {(formData.type === 'parking' || formData.type === 'garage') && (
                <div className="form-group">
                  <label>Свързано с апартамент (опционално)</label>
                  <select
                    value={formData.linked_unit_id}
                    onChange={(e) =>
                      setFormData({ ...formData, linked_unit_id: e.target.value })
                    }
                  >
                    <option value="">Не е свързано</option>
                    {getLinkableUnits().map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        Апартамент {unit.number}
                        {unit.floor && ` (Етаж ${unit.floor})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              {!editingUnit && formData.type === 'apartment' && (
                <div className="form-section">
                  <h3>Потребителски акаунт (опционално)</h3>
                  <p className="form-hint">
                    Ако попълните email и парола, ще се създаде автоматично потребителски акаунт за този апартамент.
                  </p>
                  <div className="form-group">
                    <label>Имейл за вход</label>
                    <input
                      type="email"
                      value={formData.user_email}
                      onChange={(e) =>
                        setFormData({ ...formData, user_email: e.target.value })
                      }
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="form-group">
                    <label>Парола</label>
                    <input
                      type="password"
                      value={formData.user_password}
                      onChange={(e) =>
                        setFormData({ ...formData, user_password: e.target.value })
                      }
                      placeholder="Минимум 6 символа"
                      minLength={6}
                    />
                  </div>
                </div>
              )}

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

