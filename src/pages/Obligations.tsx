import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Filter, Edit2, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { useUnitGroups } from '../hooks/useUnitGroups'
import './Obligations.css'

interface PaymentAllocationRow {
  amount: number | string
  unit_obligations: { title: string; kind: string } | null
}

interface Payment {
  id: string
  income_id: string | null
  unit_id: string
  amount: number
  payment_date: string | null
  status: string
  notes: string | null
  payment_method?: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
  payment_allocations?: PaymentAllocationRow[] | null
  units: {
    type: string
    number: string
    owner_name: string
    group?: { name: string; list_label_short: string | null; code: string } | null
  } | null
  income: {
    type: string
    description: string
    date: string
    period_start: string | null
    period_end: string | null
  } | null
}

const incomeTypeLabels: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Такса за паркоместо',
  shop_fee: 'Такса за магазин',
  other: 'Друго',
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'В брой',
  bank_transfer: 'Банков превод',
  card: 'Карта',
  other: 'Друго',
}

function descriptionLine(payment: Payment): string {
  if (payment.income) {
    const t = incomeTypeLabels[payment.income.type] ?? payment.income.type
    return `${t}: ${payment.income.description}`
  }
  const allocs = payment.payment_allocations
  if (allocs && allocs.length > 0) {
    const parts = allocs.map((a) => {
      const t = a.unit_obligations?.title ?? 'задължение'
      const amt = typeof a.amount === 'string' ? parseFloat(a.amount) : Number(a.amount)
      return `${t} ${amt.toFixed(2)} €`
    })
    return `Приспадане: ${parts.join('; ')}`
  }
  if (payment.notes?.trim()) return payment.notes.trim()
  return 'Ръчно регистрирано плащане'
}

interface UnitRow {
  id: string
  group_id: string
  type: string
  number: string
  owner_name: string
  opening_balance?: number | string | null
  group?: { name: string; code: string } | null
}

export default function Obligations() {
  const { canEdit } = useAuth()
  const { labelForCode } = useUnitGroups()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterUnit, setFilterUnit] = useState<string>('all')
  const [units, setUnits] = useState<UnitRow[]>([])
  /** Сума amount_remaining по unit_id (след миграция 015). */
  const [dueByUnit, setDueByUnit] = useState<Record<string, number>>({})
  const [maxPayForUnit, setMaxPayForUnit] = useState<number | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const [formData, setFormData] = useState({
    amount: '',
    payment_date: '',
    notes: '',
  })

  const [addForm, setAddForm] = useState({
    unit_id: '',
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: '',
    payment_method: '' as '' | 'cash' | 'bank_transfer' | 'card' | 'other',
  })

  const fetchDueByUnitFromDb = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase.from('unit_obligations').select('unit_id, amount_remaining')
      )
      if (error) throw error
      const map: Record<string, number> = {}
      for (const row of data || []) {
        const r = row as { unit_id: string; amount_remaining: number | string }
        const v = typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
        map[r.unit_id] = (map[r.unit_id] ?? 0) + (Number.isFinite(v) ? v : 0)
      }
      setDueByUnit(map)
    } catch (e) {
      console.warn('unit_obligations:', e)
      setDueByUnit({})
    }
  }

  useEffect(() => {
    fetchPayments()
    fetchUnits()
    void fetchDueByUnitFromDb()
  }, [])

  const fetchPayments = async () => {
    setLoadError(null)
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('payments')
          .select(`
          *,
          payment_allocations (
            amount,
            unit_obligations ( title, kind )
          ),
          units:unit_id (type, number, owner_name, group:group_id (name, list_label_short, code)),
          income:income_id (type, description, date, period_start, period_end)
        `)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setPayments((data as Payment[]) || [])
    } catch (error: unknown) {
      console.error('Error fetching payments:', error)
      const msg = 'Неуспешно зареждане на задълженията.'
      setLoadError(msg)
      setPayments([])
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('units')
          .select('id, group_id, type, number, owner_name, opening_balance, group:group_id (name, code)')
          .order('type')
          .order('number')
      )
      if (error) throw error
      setUnits((data as unknown as UnitRow[]) || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const openAddModal = () => {
    setAddForm({
      unit_id: '',
      amount: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
      payment_method: '',
    })
    setMaxPayForUnit(null)
    setShowAddModal(true)
  }

  useEffect(() => {
    if (!addForm.unit_id) {
      setMaxPayForUnit(null)
      return
    }
    void (async () => {
      const { data, error } = await supabaseQuery(() =>
        supabase.rpc('unit_total_due', { p_unit_id: addForm.unit_id })
      )
      if (error) {
        setMaxPayForUnit(null)
        return
      }
      const n = data != null ? Number(data) : 0
      setMaxPayForUnit(Number.isFinite(n) ? n : null)
    })()
  }, [addForm.unit_id, showAddModal])

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.unit_id || !addForm.amount || !addForm.payment_date) {
      alert('Попълни единица, сума и дата на плащане.')
      return
    }
    const amount = parseFloat(addForm.amount.replace(',', '.'))
    if (Number.isNaN(amount) || amount <= 0) {
      alert('Въведи валидна сума.')
      return
    }
    if (maxPayForUnit != null) {
      if (maxPayForUnit <= 0) {
        alert('Няма дължими суми за тази единица.')
        return
      }
      if (amount > maxPayForUnit + 0.005) {
        alert(`Сумата надвишава дължимото. Максимално: ${maxPayForUnit.toFixed(2)} €.`)
        return
      }
    }
    try {
      const { error } = await supabaseQuery(() =>
        supabase.rpc('register_payment', {
          p_unit_id: addForm.unit_id,
          p_amount: amount,
          p_payment_date: addForm.payment_date,
          p_notes: addForm.notes.trim() || null,
          p_payment_method: addForm.payment_method || null,
        })
      )
      if (error) throw error
      setShowAddModal(false)
      await fetchPayments()
      await fetchDueByUnitFromDb()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис'
      alert(
        msg.includes('null value') || msg.includes('column') || msg.includes('function')
          ? `${msg}\n\nИзпълни миграцията database_migrations/015_unit_obligations_payment_allocations.sql в Supabase SQL Editor.`
          : msg
      )
    }
  }

  const handleUpdatePayment = async () => {
    if (!editingPayment) return
    if (!editingPayment.income_id) {
      alert('Плащанията с автоматично приспадане не се редактират оттук — изтрий записа и въведи наново при нужда.')
      return
    }
    const amount = parseFloat(formData.amount.replace(',', '.'))
    if (Number.isNaN(amount) || amount <= 0) {
      alert('Въведи валидна сума.')
      return
    }
    try {
      const { error } = await supabase
        .from('payments')
        .update({
          amount,
          payment_date: formData.payment_date || null,
          notes: formData.notes.trim() || null,
        })
        .eq('id', editingPayment.id)

      if (error) throw error

      setShowModal(false)
      setEditingPayment(null)
      fetchPayments()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при обновяване'
      alert(msg)
    }
  }

  const handleDeletePayment = async (payment: Payment) => {
    if (!canEdit()) return
    const u = payment.units
    const label = u
      ? `${u.group?.name ?? labelForCode(u.type)} ${u.number} — ${payment.amount.toFixed(2)} €`
      : 'това плащане'
    if (!confirm(`Изтриване на плащане: ${label}?\n\nДействието не може да се отмени.`)) {
      return
    }
    try {
      if (!payment.income_id) {
        const { error } = await supabaseQuery(() =>
          supabase.rpc('delete_payment_with_restore', { p_payment_id: payment.id })
        )
        if (error) throw error
      } else {
        const { error } = await supabase.from('payments').delete().eq('id', payment.id)
        if (error) throw error
      }
      await fetchPayments()
      await fetchDueByUnitFromDb()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при изтриване'
      alert(msg)
    }
  }

  const openEditModal = (payment: Payment) => {
    setEditingPayment(payment)
    setFormData({
      amount: String(payment.amount),
      payment_date: payment.payment_date ? payment.payment_date.slice(0, 10) : '',
      notes: payment.notes || '',
    })
    setShowModal(true)
  }

  const filteredPayments = payments.filter((payment) => {
    if (filterUnit !== 'all' && payment.unit_id !== filterUnit) return false
    return true
  })

  const stats = {
    total: filteredPayments.reduce((sum, p) => sum + p.amount, 0),
    count: filteredPayments.length,
  }

  const unitSummaryRows = (() => {
    const list =
      filterUnit === 'all' ? units : units.filter((u) => u.id === filterUnit)
    return [...list]
      .sort((a, b) => {
        const ga = a.group?.name ?? labelForCode(a.type)
        const gb = b.group?.name ?? labelForCode(b.type)
        const c = ga.localeCompare(gb, 'bg')
        return c !== 0 ? c : a.number.localeCompare(b.number, 'bg', { numeric: true })
      })
      .map((u) => {
        const totalDue = dueByUnit[u.id] ?? 0
        return { unit: u, totalDue }
      })
  })()

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="obligations-page">
      {loadError && (
        <div className="load-error-banner" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setLoading(true)
              void fetchPayments()
              void fetchDueByUnitFromDb()
            }}
          >
            Опитай отново
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>Задължения</h1>
          <p>
            Неплатените суми идват от редове в „Задължения“ в базата (периоди по група + пренесен дълг). При плащане сумата се
            приспада автоматично: първо извънредните (най-старите), после редовните (най-старите). Не се допуска плащане над
            остатъка.
          </p>
        </div>
        <div className="page-header-actions">
          {canEdit() && (
            <button type="button" className="btn-primary" onClick={openAddModal}>
              <Plus size={20} />
              Ново плащане
            </button>
          )}
        </div>
      </div>

      <div className="stats-cards obligations-stats-simple">
        <div className="stat-card">
          <div className="stat-label">Обща сума (показани)</div>
          <div className="stat-value">{stats.total.toFixed(2)} €</div>
        </div>
        <div className="stat-card paid">
          <div className="stat-label">Брой плащания</div>
          <div className="stat-value">{stats.count}</div>
        </div>
      </div>

      <div className="obligations-period-panel">
        {units.length > 0 && unitSummaryRows.length > 0 && (
          <div className="obligations-unit-summary">
            <h2 className="obligations-summary-heading">Неплатено по единици</h2>
            <table>
              <thead>
                <tr>
                  <th>Единица</th>
                  <th>Група</th>
                  <th>Неплатено</th>
                </tr>
              </thead>
              <tbody>
                {unitSummaryRows.map(({ unit: u, totalDue }) => (
                  <tr key={u.id}>
                    <td>
                      <strong>
                        {u.group?.name ?? labelForCode(u.type)} {u.number}
                      </strong>
                      <div className="unit-owner">{u.owner_name}</div>
                    </td>
                    <td>{u.group?.name ?? '—'}</td>
                    <td>
                      <span className={totalDue > 0.009 ? 'balance-owed' : 'balance-ok'}>
                        {totalDue.toFixed(2)} €
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="obligations-period-hint">
              Колоната е сумата от всички непогасени задължения по единицата (редовни и извънредни). Редовете се създават от
              екрана „Периоди“ и от пренесения дълг при миграцията; извънредни задължения — с отделна функция (по-късно).
            </p>
          </div>
        )}
        {units.length === 0 && (
          <p className="obligations-period-empty">Няма регистрирани единици.</p>
        )}
        {units.length > 0 && unitSummaryRows.length === 0 && (
          <p className="obligations-period-empty">
            Няма единици за показване — провери филтъра „Всички единици“ по-долу.
          </p>
        )}
      </div>

      <div className="filter-section">
        <div className="filter-group">
          <Filter size={18} />
          <select
            value={filterUnit}
            onChange={(e) => setFilterUnit(e.target.value)}
            className="filter-select"
          >
            <option value="all">Всички единици</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.group?.name ?? labelForCode(unit.type)} {unit.number}
              </option>
            ))}
          </select>
        </div>
        <div className="payments-count">
          Показване: {filteredPayments.length} от {payments.length} записа
        </div>
      </div>

      <div className="payments-table">
        {filteredPayments.length === 0 ? (
          <div className="empty-state">Няма записи</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Единица</th>
                <th>Описание</th>
                <th>Сума</th>
                <th>Дата на плащане</th>
                {canEdit() && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => {
                const u = payment.units
                return (
                  <tr key={payment.id} className="payment-row">
                    <td>
                      <div className="unit-info">
                        <strong>
                          {u ? `${u.group?.name ?? labelForCode(u.type)} ${u.number}` : '—'}
                        </strong>
                        <div className="unit-owner">{u?.owner_name ?? ''}</div>
                      </div>
                    </td>
                    <td>
                      <div className="income-description">{descriptionLine(payment)}</div>
                      {payment.payment_method && paymentMethodLabels[payment.payment_method] && (
                        <div className="payment-method-tag">{paymentMethodLabels[payment.payment_method]}</div>
                      )}
                    </td>
                    <td>
                      <strong className="amount">{payment.amount.toFixed(2)} €</strong>
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
                        <div className="payment-row-actions">
                          {payment.income_id && (
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => openEditModal(payment)}
                              title="Редактирай"
                            >
                              <Edit2 size={18} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => void handleDeletePayment(payment)}
                            title="Изтрий"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Ново плащане</h2>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Сумата се приспада автоматично по ред на задълженията (извънредни първи). Не може да надвиши неплатеното по
              единицата.
              {maxPayForUnit != null && addForm.unit_id && (
                <>
                  {' '}
                  <strong>Максимум сега: {maxPayForUnit.toFixed(2)} €</strong>
                </>
              )}
            </p>
            <form onSubmit={handleCreatePayment}>
              <div className="form-group">
                <label htmlFor="add-unit">Единица *</label>
                <select
                  id="add-unit"
                  value={addForm.unit_id}
                  onChange={(e) => setAddForm({ ...addForm, unit_id: e.target.value })}
                  required
                >
                  <option value="">— Избери единица —</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.group?.name ?? labelForCode(unit.type)} {unit.number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="add-amount">Сума (€) *</label>
                <input
                  id="add-amount"
                  type="text"
                  inputMode="decimal"
                  value={addForm.amount}
                  onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="add-payment-date">Дата на плащане *</label>
                <input
                  id="add-payment-date"
                  type="date"
                  value={addForm.payment_date}
                  onChange={(e) => setAddForm({ ...addForm, payment_date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="add-method">Начин на плащане</label>
                <select
                  id="add-method"
                  value={addForm.payment_method}
                  onChange={(e) =>
                    setAddForm({
                      ...addForm,
                      payment_method: e.target.value as typeof addForm.payment_method,
                    })
                  }
                >
                  <option value="">— не е посочен —</option>
                  <option value="cash">В брой</option>
                  <option value="bank_transfer">Банков превод</option>
                  <option value="card">Карта</option>
                  <option value="other">Друго</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="add-notes">Бележки / пояснение</label>
                <textarea
                  id="add-notes"
                  value={addForm.notes}
                  onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                  rows={2}
                  placeholder="По желание"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary">
                  Запиши плащане
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && editingPayment && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Редактирай плащане</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleUpdatePayment()
              }}
            >
              <div className="form-group">
                <label>Сума (€) *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Дата на плащане</label>
                <input
                  type="date"
                  value={formData.payment_date}
                  onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
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
