import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { compactGroupLabel } from '../lib/unitDisplay'
import './Income.css'

type IncomeType = 'entry_fee' | 'parking_fee' | 'other'

interface Unit {
  id: string
  type: string
  number: string
  area: number
  owner_name: string
  group?: { name: string; list_label_short: string | null; code: string } | null
}

interface Income {
  id: string
  type: IncomeType
  amount: number
  description: string
  date: string
  unit_id: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  units?: Unit
}

const incomeTypeLabels: Record<IncomeType, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Паркоместо',
  other: 'Други',
}

export default function Income() {
  const { canEdit } = useAuth()
  const [incomes, setIncomes] = useState<Income[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingIncome, setEditingIncome] = useState<Income | null>(null)
  const [formData, setFormData] = useState({
    type: 'other' as IncomeType,
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    unit_id: '',
    period_start: '',
    period_end: '',
  })

  useEffect(() => {
    fetchUnits()
    fetchIncomes()
  }, [])

  const fetchUnits = async () => {
    try {
      const { data } = await supabase
        .from('units')
        .select('id, type, number, area, owner_name, group:group_id (name, list_label_short, code)')
        .order('type')
        .order('number')
      setUnits((data as unknown as Unit[]) || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const fetchIncomes = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('income')
          .select(`
          *,
          units:unit_id (id, type, number, area, owner_name)
        `)
          .order('date', { ascending: false })
      )

      if (error) throw error
      setIncomes(data || [])
    } catch (error) {
      console.error('Error fetching incomes:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const incomeData: any = {
        type: formData.type,
        amount: parseFloat(formData.amount),
        description: formData.description,
        date: formData.date,
        unit_id: formData.unit_id || null,
      }

      // За входна такса добавяме период
      if (formData.type === 'entry_fee') {
        incomeData.period_start = formData.period_start || null
        incomeData.period_end = formData.period_end || null
      }

      if (editingIncome) {
        const { error } = await supabase
          .from('income')
          .update(incomeData)
          .eq('id', editingIncome.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('income').insert(incomeData)

        if (error) throw error
      }

      setShowModal(false)
      setEditingIncome(null)
      resetForm()
      fetchIncomes()
    } catch (error: any) {
      alert(error.message || 'Грешка при запазване')
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'other',
      amount: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      unit_id: '',
      period_start: '',
      period_end: '',
    })
  }

  const handleEdit = (income: Income) => {
    setEditingIncome(income)
    setFormData({
      type: income.type,
      amount: income.amount.toString(),
      description: income.description,
      date: income.date.split('T')[0],
      unit_id: income.unit_id || '',
      period_start: income.period_start?.split('T')[0] || '',
      period_end: income.period_end?.split('T')[0] || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този приход?')) return

    try {
      const { error } = await supabase.from('income').delete().eq('id', id)
      if (error) throw error
      fetchIncomes()
    } catch (error: any) {
      alert(error.message || 'Грешка при изтриване')
    }
  }

  const generateEntryFees = async () => {
    if (!confirm('Генериране на входни такси за всички единици за текущия период?')) return

    try {
      // Извикваме функцията от базата данни
      const { error } = await supabase.rpc('generate_entry_fees')

      if (error) throw error
      alert('Входните такси са генерирани успешно!')
      fetchIncomes()
    } catch (error: any) {
      alert(error.message || 'Грешка при генериране на входни такси')
    }
  }

  const openNewModal = () => {
    setEditingIncome(null)
    resetForm()
    setShowModal(true)
  }

  const totalIncome = incomes.reduce((sum, item) => sum + item.amount, 0)
  const incomeByType = incomes.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + item.amount
    return acc
  }, {} as Record<IncomeType, number>)

  const getUnitDisplay = (unit: Unit | undefined) => {
    if (!unit) return '-'
    return `${compactGroupLabel(unit.group, unit.type)} ${unit.number}`
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="income-page">
      <div className="page-header">
        <div>
          <h1>Приходи</h1>
          <p>Управление на приходи</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {canEdit() && (
            <>
              <button className="btn-secondary" onClick={generateEntryFees} title="Генерирай входни такси">
                <RefreshCw size={20} />
                Генерирай входни такси
              </button>
              <button className="btn-primary" onClick={openNewModal}>
                <Plus size={20} />
                Добави приход
              </button>
            </>
          )}
        </div>
      </div>

      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
        <div className="summary-card">
          <h3>Общо приходи</h3>
          <div className="summary-amount">{totalIncome.toFixed(2)} €</div>
        </div>
        {Object.entries(incomeByType).map(([type, amount]) => (
          <div key={type} className="summary-card">
            <h3>{incomeTypeLabels[type as IncomeType]}</h3>
            <div className="summary-amount">{amount.toFixed(2)} €</div>
          </div>
        ))}
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Описание</th>
              <th>Единица</th>
              <th>Период</th>
              <th>Сума</th>
              {canEdit() && <th>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {incomes.length === 0 ? (
              <tr>
                <td colSpan={canEdit() ? 7 : 6} className="empty-cell">
                  Няма регистрирани приходи
                </td>
              </tr>
            ) : (
              incomes.map((income) => (
                <tr key={income.id}>
                  <td>
                    {format(new Date(income.date), 'dd.MM.yyyy', { locale: bg })}
                  </td>
                  <td>{incomeTypeLabels[income.type]}</td>
                  <td>{income.description}</td>
                  <td>{getUnitDisplay(income.units)}</td>
                  <td>
                    {income.period_start && income.period_end
                      ? `${format(new Date(income.period_start), 'dd.MM.yyyy', { locale: bg })} - ${format(new Date(income.period_end), 'dd.MM.yyyy', { locale: bg })}`
                      : '-'}
                  </td>
                  <td className="amount-cell">{income.amount.toFixed(2)} €</td>
                  {canEdit() && (
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-btn"
                          onClick={() => handleEdit(income)}
                          title="Редактирай"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={() => handleDelete(income.id)}
                          title="Изтрий"
                        >
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
            <h2>{editingIncome ? 'Редактирай приход' : 'Добави приход'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Тип приход *</label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const newType = e.target.value as IncomeType
                    setFormData({ ...formData, type: newType })
                    // Ако не е входна такса, изчистваме периода
                    if (newType !== 'entry_fee') {
                      setFormData(prev => ({ ...prev, period_start: '', period_end: '' }))
                    }
                  }}
                  required
                >
                  <option value="other">Други</option>
                  <option value="entry_fee">Входна такса</option>
                  <option value="parking_fee">Паркоместо</option>
                </select>
              </div>
              <div className="form-group">
                <label>Сума (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData({ ...formData, amount: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label>Описание *</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label>Дата *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData({ ...formData, date: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label>Единица (опционално)</label>
                <select
                  value={formData.unit_id}
                  onChange={(e) =>
                    setFormData({ ...formData, unit_id: e.target.value })
                  }
                >
                  <option value="">Не е свързано с единица</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {getUnitDisplay(unit)} - {unit.owner_name}
                    </option>
                  ))}
                </select>
              </div>
              {formData.type === 'entry_fee' && (
                <>
                  <div className="form-group">
                    <label>Начало на период (опционално)</label>
                    <input
                      type="date"
                      value={formData.period_start}
                      onChange={(e) =>
                        setFormData({ ...formData, period_start: e.target.value })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Край на период (опционално)</label>
                    <input
                      type="date"
                      value={formData.period_end}
                      onChange={(e) =>
                        setFormData({ ...formData, period_end: e.target.value })
                      }
                    />
                  </div>
                </>
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
