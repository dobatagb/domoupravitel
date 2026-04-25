import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import type { FinanceYearScope } from '../components/YearScopeSelect'
import './Income.css'
import './Expenses.css'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'

export interface IncomeRow {
  id: string
  type: 'entry_fee' | 'parking_fee' | 'other'
  amount: number
  description: string
  date: string
  unit_id: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  /** Къде влиза сумата за наличност; repair_fund — миграция 058 */
  received_to?: 'cash' | 'bank_transfer' | 'repair_fund' | null
}

type UnitOpt = {
  id: string
  type?: string
  number: string | null
  owner_name: string | null
  group: { name: string | null } | null
}

const typeLabels: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Паркомясто',
  other: 'Други',
}

function unitLabel(u: UnitOpt): string {
  const g = u.group?.name
  const n = u.number != null ? formatUnitNumberDisplay(u.number) : ''
  return [g, n].filter(Boolean).join(' ') || u.owner_name || '—'
}

function incomeTargetLabel(v: string | null | undefined): string {
  const x = (v ?? 'cash').toLowerCase()
  if (x === 'bank_transfer') return 'Сметка'
  if (x === 'repair_fund') return 'Фонд ремонт'
  return 'Каса'
}

type IncomeRecordsProps = {
  year: FinanceYearScope
  /** Скрива заглавието и бутона „Добави“ — за вграждане в „Финанси“ */
  embedded?: boolean
}

export function IncomeRecords({ year, embedded = false }: IncomeRecordsProps) {
  const { canEdit } = useAuth()
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [units, setUnits] = useState<UnitOpt[]>([])
  const [unitMap, setUnitMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<IncomeRow | null>(null)
  const [formData, setFormData] = useState({
    type: 'other' as IncomeRow['type'],
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    unit_id: '',
    period_start: '',
    period_end: '',
    received_to: 'cash' as 'cash' | 'bank_transfer' | 'repair_fund',
  })

  const fetchUnits = useCallback(async () => {
    const { data } = await supabase
      .from('units')
      .select('id, type, number, owner_name, group:group_id (name)')
      .eq('archived', false)
      .order('type', { ascending: true })
      .order('number', { ascending: true })
    const list = sortUnitsByTypeAndNumber(((data ?? []) as unknown) as UnitOpt[])
    setUnits(list)
    setUnitMap(Object.fromEntries(list.map((u) => [u.id, unitLabel(u)])))
  }, [])

  const fetchIncome = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase.from('income').select('*').order('date', { ascending: false })
      if (year !== 'all') {
        q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
      }
      const { data, error } = await supabaseQuery(() => q)
      if (error) throw error
      setRows((data as IncomeRow[]) || [])
    } catch (e) {
      console.error('income fetch:', e)
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    void fetchUnits()
  }, [fetchUnits])

  useEffect(() => {
    void fetchIncome()
  }, [fetchIncome])

  const resetForm = () => {
    setFormData({
      type: 'other',
      amount: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      unit_id: '',
      period_start: '',
      period_end: '',
      received_to: 'cash',
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const amount = parseFloat(formData.amount.replace(',', '.'))
    if (!Number.isFinite(amount)) {
      alert('Невалидна сума')
      return
    }
    const unitId = formData.unit_id.trim() || null
    const payload = {
      type: formData.type,
      amount,
      description: formData.description.trim(),
      date: formData.date,
      unit_id: unitId,
      period_start: formData.period_start.trim() || null,
      period_end: formData.period_end.trim() || null,
      received_to: formData.received_to,
    }

    try {
      if (editing) {
        const { error } = await supabase.from('income').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('income').insert(payload)
        if (error) throw error
      }
      setShowModal(false)
      setEditing(null)
      resetForm()
      void fetchIncome()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при запис')
    }
  }

  const handleEdit = (row: IncomeRow) => {
    setEditing(row)
    setFormData({
      type: row.type,
      amount: String(row.amount),
      description: row.description,
      date: row.date.split('T')[0],
      unit_id: row.unit_id || '',
      period_start: row.period_start?.split('T')[0] || '',
      period_end: row.period_end?.split('T')[0] || '',
      received_to:
        row.received_to === 'bank_transfer'
          ? 'bank_transfer'
          : row.received_to === 'repair_fund'
            ? 'repair_fund'
            : 'cash',
    })
    setShowModal(true)
  }

  const handleDelete = async (row: IncomeRow) => {
    if (!confirm('Изтриване на този приход?')) return
    try {
      const { error } = await supabase.from('income').delete().eq('id', row.id)
      if (error) throw error
      void fetchIncome()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка')
    }
  }

  const total = rows.reduce((s, r) => s + Number(r.amount), 0)

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <>
      {!embedded && canEdit() && (
        <div className="page-header" style={{ marginBottom: '1rem' }}>
          <div />
          <button type="button" className="btn-primary" onClick={() => { setEditing(null); resetForm(); setShowModal(true) }}>
            <Plus size={20} />
            Добави приход
          </button>
        </div>
      )}
      {embedded && canEdit() && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button type="button" className="btn-primary" onClick={() => { setEditing(null); resetForm(); setShowModal(true) }}>
            <Plus size={20} />
            Добави приход
          </button>
        </div>
      )}

      <div
        className="summary-cards"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}
      >
        <div className="summary-card">
          <h3>Общо приходи {year === 'all' ? '' : `(${year})`}</h3>
          <div className="summary-amount">{total.toFixed(2)} €</div>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Описание</th>
              <th>Къде</th>
              <th>Обект</th>
              <th>Сума</th>
              {canEdit() && <th>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canEdit() ? 7 : 6} className="empty-cell">
                  Няма записани приходи за избрания период
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{format(new Date(row.date), 'dd.MM.yyyy', { locale: bg })}</td>
                  <td>
                    <span className="income-type-badge">{typeLabels[row.type] ?? row.type}</span>
                  </td>
                  <td>{row.description}</td>
                  <td>{incomeTargetLabel(row.received_to)}</td>
                  <td className="income-unit-cell">
                    {row.unit_id ? unitMap[row.unit_id] ?? '—' : '—'}
                  </td>
                  <td className="amount-cell">{Number(row.amount).toFixed(2)} €</td>
                  {canEdit() && (
                    <td>
                      <div className="table-actions">
                        <button type="button" className="icon-btn" onClick={() => handleEdit(row)} title="Редактирай">
                          <Edit2 size={18} />
                        </button>
                        <button type="button" className="icon-btn danger" onClick={() => void handleDelete(row)} title="Изтрий">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Редактирай приход' : 'Добави приход'}</h2>
            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="form-group">
                <label>Тип *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as IncomeRow['type'] })}
                  required
                >
                  <option value="entry_fee">{typeLabels.entry_fee}</option>
                  <option value="parking_fee">{typeLabels.parking_fee}</option>
                  <option value="other">{typeLabels.other}</option>
                </select>
              </div>
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
                <label>Описание *</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Дата *</label>
                <input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="income-received-to">Прието в * (наличност)</label>
                <select
                  id="income-received-to"
                  value={formData.received_to}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      received_to: e.target.value as 'cash' | 'bank_transfer' | 'repair_fund',
                    })
                  }
                  required
                >
                  <option value="cash">Каса (в брой)</option>
                  <option value="bank_transfer">Банкова сметка</option>
                  <option value="repair_fund">Фонд ремонт (по закон за ЕС)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Обект (опционално)</label>
                <select value={formData.unit_id} onChange={(e) => setFormData({ ...formData, unit_id: e.target.value })}>
                  <option value="">—</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Период от (опционално)</label>
                <input type="date" value={formData.period_start} onChange={(e) => setFormData({ ...formData, period_start: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Период до (опционално)</label>
                <input type="date" value={formData.period_end} onChange={(e) => setFormData({ ...formData, period_end: e.target.value })} />
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
    </>
  )
}
