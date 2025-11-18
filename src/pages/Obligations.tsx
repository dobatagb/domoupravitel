import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CheckCircle, Clock, AlertCircle, Filter, Edit2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Obligations.css'

type PaymentStatus = 'pending' | 'paid' | 'overdue'

interface Payment {
  id: string
  income_id: string
  unit_id: string
  amount: number
  payment_date: string | null
  status: PaymentStatus
  notes: string | null
  created_at: string
  updated_at: string
  unit: {
    type: string
    number: string
    floor: number | null
    owner_name: string
  }
  income: {
    type: string
    description: string
    date: string
    period_start: string | null
    period_end: string | null
  }
}

const statusLabels: Record<PaymentStatus, string> = {
  pending: 'Чака плащане',
  paid: 'Платено',
  overdue: 'Просрочено',
}

const statusIcons: Record<PaymentStatus, typeof CheckCircle> = {
  pending: Clock,
  paid: CheckCircle,
  overdue: AlertCircle,
}

const statusColors: Record<PaymentStatus, string> = {
  pending: 'var(--warning)',
  paid: 'var(--success)',
  overdue: 'var(--danger)',
}

const incomeTypeLabels: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Такса за паркоместо',
  shop_fee: 'Такса за магазин',
  other: 'Друго',
}

const unitTypeLabels: Record<string, string> = {
  apartment: 'Апартамент',
  garage: 'Гараж',
  shop: 'Магазин',
  parking: 'Паркомясто',
}

export default function Obligations() {
  const { canEdit } = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<PaymentStatus | 'all'>('all')
  const [filterUnit, setFilterUnit] = useState<string>('all')
  const [units, setUnits] = useState<Array<{ id: string; type: string; number: string }>>([])
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    status: 'pending' as PaymentStatus,
    payment_date: '',
    notes: '',
  })

  useEffect(() => {
    fetchPayments()
    fetchUnits()
  }, [])

  const fetchPayments = async () => {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          unit:unit_id (type, number, floor, owner_name),
          income:income_id (type, description, date, period_start, period_end)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setPayments(data || [])
    } catch (error) {
      console.error('Error fetching payments:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      const { data } = await supabase
        .from('units')
        .select('id, type, number')
        .order('type')
        .order('number')
      setUnits(data || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const handleUpdateStatus = async () => {
    if (!editingPayment) return

    try {
      const updateData: any = {
        status: formData.status,
        notes: formData.notes || null,
      }

      if (formData.status === 'paid' && formData.payment_date) {
        updateData.payment_date = formData.payment_date
      } else if (formData.status !== 'paid') {
        updateData.payment_date = null
      }

      const { error } = await supabase
        .from('payments')
        .update(updateData)
        .eq('id', editingPayment.id)

      if (error) throw error

      setShowModal(false)
      setEditingPayment(null)
      fetchPayments()
    } catch (error: any) {
      alert(error.message || 'Грешка при обновяване')
    }
  }

  const openEditModal = (payment: Payment) => {
    setEditingPayment(payment)
    setFormData({
      status: payment.status,
      payment_date: payment.payment_date || '',
      notes: payment.notes || '',
    })
    setShowModal(true)
  }

  const filteredPayments = payments.filter((payment) => {
    if (filterStatus !== 'all' && payment.status !== filterStatus) return false
    if (filterUnit !== 'all' && payment.unit_id !== filterUnit) return false
    return true
  })

  const stats = {
    total: filteredPayments.reduce((sum, p) => sum + p.amount, 0),
    pending: filteredPayments
      .filter((p) => p.status === 'pending')
      .reduce((sum, p) => sum + p.amount, 0),
    paid: filteredPayments
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0),
    overdue: filteredPayments
      .filter((p) => p.status === 'overdue')
      .reduce((sum, p) => sum + p.amount, 0),
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="obligations-page">
      <div className="page-header">
        <div>
          <h1>Задължения</h1>
          <p>Преглед на платени и неплатени такси</p>
        </div>
      </div>

      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-label">Обща сума</div>
          <div className="stat-value">{stats.total.toFixed(2)} лв</div>
        </div>
        <div className="stat-card pending">
          <div className="stat-label">Чака плащане</div>
          <div className="stat-value">{stats.pending.toFixed(2)} лв</div>
        </div>
        <div className="stat-card paid">
          <div className="stat-label">Платено</div>
          <div className="stat-value">{stats.paid.toFixed(2)} лв</div>
        </div>
        <div className="stat-card overdue">
          <div className="stat-label">Просрочено</div>
          <div className="stat-value">{stats.overdue.toFixed(2)} лв</div>
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-group">
          <Filter size={18} />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as PaymentStatus | 'all')}
            className="filter-select"
          >
            <option value="all">Всички статуси</option>
            <option value="pending">Чака плащане</option>
            <option value="paid">Платено</option>
            <option value="overdue">Просрочено</option>
          </select>
        </div>
        <div className="filter-group">
          <select
            value={filterUnit}
            onChange={(e) => setFilterUnit(e.target.value)}
            className="filter-select"
          >
            <option value="all">Всички единици</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitTypeLabels[unit.type]} {unit.number}
              </option>
            ))}
          </select>
        </div>
        <div className="payments-count">
          Показване: {filteredPayments.length} от {payments.length} плащания
        </div>
      </div>

      <div className="payments-table">
        {filteredPayments.length === 0 ? (
          <div className="empty-state">Няма намерени плащания</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Единица</th>
                <th>Тип такса</th>
                <th>Период</th>
                <th>Сума</th>
                <th>Статус</th>
                <th>Дата на плащане</th>
                {canEdit() && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => {
                const StatusIcon = statusIcons[payment.status]
                return (
                  <tr key={payment.id} className={`payment-row status-${payment.status}`}>
                    <td>
                      <div className="unit-info">
                        <strong>
                          {unitTypeLabels[payment.unit.type]} {payment.unit.number}
                        </strong>
                        {payment.unit.floor && (
                          <span className="unit-floor">Етаж {payment.unit.floor}</span>
                        )}
                        <div className="unit-owner">{payment.unit.owner_name}</div>
                      </div>
                    </td>
                    <td>
                      <div className="income-type">
                        {incomeTypeLabels[payment.income.type] || payment.income.type}
                      </div>
                      <div className="income-description">{payment.income.description}</div>
                    </td>
                    <td>
                      {payment.income.period_start && payment.income.period_end ? (
                        <div className="period">
                          {format(new Date(payment.income.period_start), 'dd.MM.yyyy', {
                            locale: bg,
                          })}{' '}
                          -{' '}
                          {format(new Date(payment.income.period_end), 'dd.MM.yyyy', {
                            locale: bg,
                          })}
                        </div>
                      ) : (
                        <div className="period">
                          {format(new Date(payment.income.date), 'dd.MM.yyyy', { locale: bg })}
                        </div>
                      )}
                    </td>
                    <td>
                      <strong className="amount">{payment.amount.toFixed(2)} лв</strong>
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ backgroundColor: statusColors[payment.status] + '20' }}
                      >
                        <StatusIcon size={16} color={statusColors[payment.status]} />
                        {statusLabels[payment.status]}
                      </span>
                    </td>
                    <td>
                      {payment.payment_date ? (
                        format(new Date(payment.payment_date), 'dd.MM.yyyy', { locale: bg })
                      ) : (
                        <span className="no-date">—</span>
                      )}
                    </td>
                    {canEdit() && (
                      <td>
                        <button
                          className="icon-btn"
                          onClick={() => openEditModal(payment)}
                          title="Редактирай статус"
                        >
                          <Edit2 size={18} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && editingPayment && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Редактирай статус на плащане</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleUpdateStatus()
              }}
            >
              <div className="form-group">
                <label>Статус *</label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value as PaymentStatus })
                  }
                  required
                >
                  <option value="pending">Чака плащане</option>
                  <option value="paid">Платено</option>
                  <option value="overdue">Просрочено</option>
                </select>
              </div>

              {formData.status === 'paid' && (
                <div className="form-group">
                  <label>Дата на плащане *</label>
                  <input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label>Бележки</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="Допълнителна информация"
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

