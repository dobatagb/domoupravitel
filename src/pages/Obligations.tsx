import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CalendarRange, Filter, Edit2, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { useUnitGroups } from '../hooks/useUnitGroups'
import './Obligations.css'

interface Payment {
  id: string
  income_id: string | null
  unit_id: string
  amount: number
  payment_date: string | null
  status: string
  notes: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
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

function descriptionLine(payment: Payment): string {
  if (payment.income) {
    const t = incomeTypeLabels[payment.income.type] ?? payment.income.type
    return `${t}: ${payment.income.description}`
  }
  if (payment.notes?.trim()) return payment.notes.trim()
  return 'Ръчно регистрирано плащане'
}

/** Плащането покрива част от избрания билинг период (инклузивни дати). */
function paymentOverlapsBillingPeriod(
  p: Payment,
  dateFrom: string,
  dateTo: string
): boolean {
  const ps = p.period_start
  const pe = p.period_end
  if (!ps || !pe) return false
  const a = ps.slice(0, 10)
  const b = pe.slice(0, 10)
  const bf = dateFrom.slice(0, 10)
  const bt = dateTo.slice(0, 10)
  return a <= bt && b >= bf
}

interface BillingPeriodRow {
  id: string
  name: string
  date_from: string
  date_to: string
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

function parseOpeningBalance(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export default function Obligations() {
  const { canEdit } = useAuth()
  const { labelForCode } = useUnitGroups()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterUnit, setFilterUnit] = useState<string>('all')
  const [units, setUnits] = useState<UnitRow[]>([])
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriodRow[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const [groupAmounts, setGroupAmounts] = useState<Record<string, number>>({})
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
  })

  useEffect(() => {
    fetchPayments()
    fetchUnits()
    void fetchBillingPeriods()
  }, [])

  const fetchBillingPeriods = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('billing_periods')
          .select('id, name, date_from, date_to')
          .order('sort_order', { ascending: true })
          .order('date_from', { ascending: false })
      )
      if (error) throw error
      const list = (data as BillingPeriodRow[]) || []
      setBillingPeriods(list)
      setSelectedPeriodId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        return list[0]?.id ?? ''
      })
    } catch (e) {
      console.error('billing_periods:', e)
      setBillingPeriods([])
    }
  }

  useEffect(() => {
    if (!selectedPeriodId) {
      setGroupAmounts({})
      return
    }
    void (async () => {
      try {
        const { data, error } = await supabaseQuery(() =>
          supabase.from('period_group_amounts').select('group_id, amount').eq('period_id', selectedPeriodId)
        )
        if (error) throw error
        const map: Record<string, number> = {}
        for (const row of data || []) {
          const r = row as { group_id: string; amount: number | string }
          map[r.group_id] = typeof r.amount === 'string' ? parseFloat(r.amount) : Number(r.amount)
        }
        setGroupAmounts(map)
      } catch (e) {
        console.error('period_group_amounts:', e)
        setGroupAmounts({})
      }
    })()
  }, [selectedPeriodId])

  const fetchPayments = async () => {
    setLoadError(null)
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('payments')
          .select(`
          *,
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
    })
    setShowAddModal(true)
  }

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.unit_id || !addForm.amount || !addForm.payment_date) {
      alert('Попълни единица, сума и дата на плащане.')
      return
    }
    const bp = billingPeriods.find((p) => p.id === selectedPeriodId)
    if (!bp) {
      alert('Избери билинг период в панела „Период на таксуване“ горе.')
      return
    }
    const amount = parseFloat(addForm.amount.replace(',', '.'))
    if (Number.isNaN(amount) || amount <= 0) {
      alert('Въведи валидна сума.')
      return
    }
    try {
      const { error } = await supabase.from('payments').insert({
        income_id: null,
        unit_id: addForm.unit_id,
        amount,
        period_start: bp.date_from.slice(0, 10),
        period_end: bp.date_to.slice(0, 10),
        payment_date: addForm.payment_date,
        status: 'paid',
        notes: addForm.notes.trim() || null,
      })
      if (error) throw error
      setShowAddModal(false)
      fetchPayments()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис'
      alert(
        msg.includes('null value') || msg.includes('column')
          ? `${msg}\n\nИзпълни миграцията database_migrations/002_payments_simple.sql в Supabase SQL Editor.`
          : msg
      )
    }
  }

  const handleUpdatePayment = async () => {
    if (!editingPayment) return
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
      ? `${u.group?.name ?? labelForCode(u.type)} ${u.number} — ${payment.amount.toFixed(2)} лв`
      : 'това плащане'
    if (!confirm(`Изтриване на плащане: ${label}?\n\nДействието не може да се отмени.`)) {
      return
    }
    try {
      const { error } = await supabase.from('payments').delete().eq('id', payment.id)
      if (error) throw error
      await fetchPayments()
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

  const selectedBillingPeriod = billingPeriods.find((p) => p.id === selectedPeriodId)
  const unitSummaryRows = (() => {
    if (!selectedBillingPeriod) return []
    const { date_from: df, date_to: dt } = selectedBillingPeriod
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
        const due = groupAmounts[u.group_id]
        const dueNum = due != null && !Number.isNaN(due) ? due : null
        const opening = parseOpeningBalance(u.opening_balance)
        const paid = payments
          .filter((p) => p.unit_id === u.id && paymentOverlapsBillingPeriod(p, df, dt))
          .reduce((s, p) => s + p.amount, 0)
        const periodPart = dueNum ?? 0
        const balance = periodPart - paid + opening
        return { unit: u, due: dueNum, opening, paid, balance }
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
            За периода: дължимото по група идва от „Периоди“. Различни стари задължения по апартамент се въвеждат като
            пренесен дълг в картона на единицата. Остатъкът включва и двете, минус платеното за избрания период.
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
          <div className="stat-value">{stats.total.toFixed(2)} лв</div>
        </div>
        <div className="stat-card paid">
          <div className="stat-label">Брой плащания</div>
          <div className="stat-value">{stats.count}</div>
        </div>
      </div>

      <div className="obligations-period-panel">
        <div className="obligations-period-head">
          <h2>
            <CalendarRange size={22} className="obligations-period-icon" aria-hidden />
            Период на таксуване
          </h2>
          <select
            className="filter-select obligations-period-select"
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            aria-label="Билинг период"
          >
            {billingPeriods.length === 0 ? (
              <option value="">Няма периоди — добави в „Периоди“</option>
            ) : (
              billingPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({format(new Date(p.date_from), 'dd.MM.yyyy', { locale: bg })} —{' '}
                  {format(new Date(p.date_to), 'dd.MM.yyyy', { locale: bg })})
                </option>
              ))
            )}
          </select>
        </div>
        {selectedBillingPeriod && unitSummaryRows.length > 0 && (
          <div className="obligations-unit-summary">
            <table>
              <thead>
                <tr>
                  <th>Единица</th>
                  <th>Група</th>
                  <th>Дължимо (период)</th>
                  <th>Пренесен</th>
                  <th>Платено (за периода)</th>
                  <th>Остатък</th>
                </tr>
              </thead>
              <tbody>
                {unitSummaryRows.map(({ unit: u, due, opening, paid, balance }) => (
                  <tr key={u.id}>
                    <td>
                      <strong>
                        {u.group?.name ?? labelForCode(u.type)} {u.number}
                      </strong>
                      <div className="unit-owner">{u.owner_name}</div>
                    </td>
                    <td>{u.group?.name ?? '—'}</td>
                    <td>{due != null ? `${due.toFixed(2)} лв` : '—'}</td>
                    <td>{opening > 0 ? `${opening.toFixed(2)} лв` : '—'}</td>
                    <td>{paid.toFixed(2)} лв</td>
                    <td>
                      <span className={balance > 0.009 ? 'balance-owed' : 'balance-ok'}>
                        {balance.toFixed(2)} лв
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="obligations-period-hint">
              „Дължимо (период)“ е от екрана „Периоди“. „Пренесен“ е полето в единицата (стари задължения). Остатък = дължимо
              за периода − платено за периода + пренесен дълг. Намаляваш пренесения дълг ръчно в единицата, когато погасиш
              старата сума.
            </p>
          </div>
        )}
        {selectedBillingPeriod && units.length === 0 && (
          <p className="obligations-period-empty">Няма регистрирани единици.</p>
        )}
        {selectedBillingPeriod && units.length > 0 && unitSummaryRows.length === 0 && (
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
                    </td>
                    <td>
                      <strong className="amount">{payment.amount.toFixed(2)} лв</strong>
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
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => openEditModal(payment)}
                            title="Редактирай"
                          >
                            <Edit2 size={18} />
                          </button>
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
              Плащането се отнася към избрания горе билинг период. Попълни единица, сума и дата на плащане.
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
                <label htmlFor="add-amount">Сума (лв) *</label>
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
                <label>Сума (лв) *</label>
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
