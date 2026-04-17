import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { useUnitGroups } from '../hooks/useUnitGroups'
import './Fees.css'

type FeeType = 'entry_fee' | 'parking_fee' | 'shop_fee'

interface Fee {
  id: string
  type: FeeType
  amount: number
  description: string | null
  unit_group_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  unit_group?: { id: string; name: string; code: string } | null
}

const feeTypeLabels: Record<FeeType, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Такса за паркоместо',
  shop_fee: 'Такса за магазин',
}

export default function Fees() {
  const { userRole, loading: authLoading } = useAuth()
  const { groups } = useUnitGroups()
  const [fees, setFees] = useState<Fee[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingFee, setEditingFee] = useState<Fee | null>(null)
  const [formData, setFormData] = useState({
    type: 'entry_fee' as FeeType,
    amount: '',
    description: '',
    unit_group_id: '' as string,
    is_active: true,
  })

  useEffect(() => {
    if (userRole !== 'admin') return
    void fetchFees()
  }, [userRole])

  const fetchFees = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('fees')
          .select('*, unit_group:unit_group_id (id, name, code)')
          .order('type', { ascending: true })
          .order('unit_group_id', { ascending: true })
      )

      if (error) throw error
      setFees((data as Fee[]) || [])
    } catch (error) {
      console.error('Error fetching fees:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const feeData: Record<string, unknown> = {
        type: formData.type,
        amount: parseFloat(formData.amount),
        description: formData.description || null,
        unit_group_id: formData.unit_group_id || null,
        is_active: formData.is_active,
      }

      if (editingFee) {
        const { error } = await supabase.from('fees').update(feeData).eq('id', editingFee.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('fees').insert(feeData)

        if (error) throw error
      }

      setShowModal(false)
      setEditingFee(null)
      resetForm()
      fetchFees()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при запазване'
      alert(msg)
    }
  }

  const handleEdit = (fee: Fee) => {
    setEditingFee(fee)
    setFormData({
      type: fee.type,
      amount: fee.amount.toString(),
      description: fee.description || '',
      unit_group_id: fee.unit_group_id || '',
      is_active: fee.is_active,
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази такса?')) return

    try {
      const { error } = await supabase.from('fees').delete().eq('id', id)
      if (error) throw error
      fetchFees()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при изтриване'
      alert(msg)
    }
  }

  const toggleActive = async (fee: Fee) => {
    try {
      const { error } = await supabase
        .from('fees')
        .update({ is_active: !fee.is_active })
        .eq('id', fee.id)

      if (error) throw error
      fetchFees()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при обновяване'
      alert(msg)
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'entry_fee',
      amount: '',
      description: '',
      unit_group_id: '',
      is_active: true,
    })
  }

  const openNewModal = () => {
    setEditingFee(null)
    resetForm()
    setShowModal(true)
  }

  if (authLoading || userRole === null) {
    return <div>Зареждане...</div>
  }

  if (userRole !== 'admin') {
    return (
      <div className="fees-page">
        <div className="access-denied">
          <h2>Нямате достъп</h2>
          <p>Само администраторите могат да управляват таксите.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="fees-page">
      <div className="page-header">
        <div>
          <h1>Такси</h1>
          <p>Управление на входни такси, такси за паркоместа и магазини</p>
        </div>
        <button className="btn-primary" onClick={openNewModal}>
          <Plus size={20} />
          Добави такса
        </button>
      </div>

      <div className="fees-grid">
        {fees.length === 0 ? (
          <div className="empty-state">Няма дефинирани такси</div>
        ) : (
          fees.map((fee) => (
            <div key={fee.id} className={`fee-card ${!fee.is_active ? 'inactive' : ''}`}>
              <div className="fee-header">
                <div>
                  <h3>
                    {feeTypeLabels[fee.type]}
                    {fee.unit_group?.name && ` — ${fee.unit_group.name}`}
                  </h3>
                  <div className="fee-status">
                    {fee.is_active ? (
                      <span className="status-badge active">
                        <CheckCircle size={14} />
                        Активна
                      </span>
                    ) : (
                      <span className="status-badge inactive">
                        <XCircle size={14} />
                        Неактивна
                      </span>
                    )}
                  </div>
                </div>
                <div className="fee-actions">
                  <button
                    className="icon-btn"
                    onClick={() => toggleActive(fee)}
                    title={fee.is_active ? 'Деактивирай' : 'Активирай'}
                  >
                    {fee.is_active ? <XCircle size={18} /> : <CheckCircle size={18} />}
                  </button>
                  <button className="icon-btn" onClick={() => handleEdit(fee)} title="Редактирай">
                    <Edit2 size={18} />
                  </button>
                  <button className="icon-btn danger" onClick={() => handleDelete(fee.id)} title="Изтрий">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <div className="fee-details">
                <div className="fee-amount">
                  <span className="amount-label">Сума:</span>
                  <span className="amount-value">{fee.amount.toFixed(2)} лв</span>
                </div>
                {fee.description && (
                  <div className="fee-description">
                    <span className="description-label">Описание:</span>
                    <span className="description-value">{fee.description}</span>
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
            <h2>{editingFee ? 'Редактирай такса' : 'Добави такса'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Тип такса *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as FeeType })}
                  required
                  disabled={!!editingFee}
                >
                  <option value="entry_fee">Входна такса</option>
                  <option value="parking_fee">Такса за паркоместо</option>
                  <option value="shop_fee">Такса за магазин</option>
                </select>
              </div>

              <div className="form-group">
                <label>Група единици</label>
                <select
                  value={formData.unit_group_id}
                  onChange={(e) => setFormData({ ...formData, unit_group_id: e.target.value })}
                >
                  <option value="">Всички групи</option>
                  {groups
                    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
                <small className="form-hint">
                  Празно = важи за всички групи (напр. обща входна такса). Иначе избери група от номенклатурата.
                </small>
              </div>

              <div className="form-group">
                <label>Сума (лв) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                  placeholder="Напр. 8.00"
                />
              </div>

              <div className="form-group">
                <label>Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  placeholder="Допълнителна информация за таксата"
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  <span>Активна такса</span>
                </label>
                <small className="form-hint">
                  Неактивните такси не се използват при автоматично генериране
                </small>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
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
