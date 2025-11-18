import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, Calculator, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Expenses.css'

type DistributionMethod = 'equal' | 'by_area' | 'manual'

interface Unit {
  id: string
  type: string
  number: string
  area: number
  owner_name: string
}

interface ExpenseDistribution {
  id: string
  expense_id: string
  unit_id: string
  amount: number
  units?: Unit
}

interface Expense {
  id: string
  amount: number
  description: string
  date: string
  category: string
  distribution_method: DistributionMethod
  created_at: string
  distributions?: ExpenseDistribution[]
  distributions_count?: number
}

const categories = [
  'Поддръжка и ремонт',
  'Комунални услуги',
  'Почистване',
  'Осигуровки',
  'Управление',
  'Други',
]

const distributionMethodLabels: Record<DistributionMethod, string> = {
  equal: 'Равно',
  by_area: 'По площ',
  manual: 'Ръчно',
}

export default function Expenses() {
  const { canEdit } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDistributionModal, setShowDistributionModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [distributingExpense, setDistributingExpense] = useState<Expense | null>(null)
  const [distributions, setDistributions] = useState<Record<string, number>>({})
  const [formData, setFormData] = useState({
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: '',
    distribution_method: 'equal' as DistributionMethod,
  })

  useEffect(() => {
    fetchUnits()
    fetchExpenses()
  }, [])

  const fetchUnits = async () => {
    try {
      const { data } = await supabase
        .from('units')
        .select('id, type, number, area, owner_name')
        .order('type')
        .order('number')
      setUnits(data || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const fetchExpenses = async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select(`
          *,
          distributions:expense_distributions (
            id,
            unit_id,
            amount,
            units:unit_id (id, type, number, area, owner_name)
          )
        `)
        .order('date', { ascending: false })

      if (error) throw error
      
      // Добавяме брой разпределения за всеки разход
      const expensesWithCounts = (data || []).map((expense: any) => ({
        ...expense,
        distributions_count: expense.distributions?.length || 0,
      }))
      
      setExpenses(expensesWithCounts)
    } catch (error) {
      console.error('Error fetching expenses:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const expenseData = {
        amount: parseFloat(formData.amount),
        description: formData.description,
        date: formData.date,
        category: formData.category,
        distribution_method: formData.distribution_method,
      }

      if (editingExpense) {
        const { error } = await supabase
          .from('expenses')
          .update(expenseData)
          .eq('id', editingExpense.id)

        if (error) throw error
      } else {
        const { error } = await supabase.from('expenses').insert(expenseData)

        if (error) throw error
      }

      setShowModal(false)
      setEditingExpense(null)
      resetForm()
      fetchExpenses()
    } catch (error: any) {
      alert(error.message || 'Грешка при запазване')
    }
  }

  const resetForm = () => {
    setFormData({
      amount: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      category: '',
      distribution_method: 'equal',
    })
  }

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense)
    setFormData({
      amount: expense.amount.toString(),
      description: expense.description,
      date: expense.date.split('T')[0],
      category: expense.category,
      distribution_method: expense.distribution_method,
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този разход?')) return

    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id)
      if (error) throw error
      fetchExpenses()
    } catch (error: any) {
      alert(error.message || 'Грешка при изтриване')
    }
  }

  const openNewModal = () => {
    setEditingExpense(null)
    resetForm()
    setShowModal(true)
  }

  const openDistributionModal = async (expense: Expense) => {
    setDistributingExpense(expense)
    
    // Зареждаме съществуващите разпределения
    const { data } = await supabase
      .from('expense_distributions')
      .select('unit_id, amount')
      .eq('expense_id', expense.id)
    
    const existingDistributions: Record<string, number> = {}
    if (data) {
      data.forEach((dist) => {
        existingDistributions[dist.unit_id] = dist.amount
      })
    }
    
    // Ако няма разпределения, генерираме ги според метода
    if (Object.keys(existingDistributions).length === 0) {
      if (expense.distribution_method === 'equal') {
        const amountPerUnit = expense.amount / units.length
        units.forEach((unit) => {
          existingDistributions[unit.id] = amountPerUnit
        })
      } else if (expense.distribution_method === 'by_area') {
        const totalArea = units.reduce((sum, unit) => sum + unit.area, 0)
        units.forEach((unit) => {
          existingDistributions[unit.id] = (expense.amount * unit.area) / totalArea
        })
      }
    }
    
    setDistributions(existingDistributions)
    setShowDistributionModal(true)
  }

  const handleDistributionSubmit = async () => {
    if (!distributingExpense) return

    try {
      // Изтриваме старите разпределения
      await supabase
        .from('expense_distributions')
        .delete()
        .eq('expense_id', distributingExpense.id)

      // Създаваме новите разпределения
      const distributionsToInsert = Object.entries(distributions)
        .filter(([_, amount]) => amount > 0)
        .map(([unit_id, amount]) => ({
          expense_id: distributingExpense.id,
          unit_id,
          amount: parseFloat(amount.toFixed(2)),
        }))

      if (distributionsToInsert.length > 0) {
        const { error } = await supabase
          .from('expense_distributions')
          .insert(distributionsToInsert)

        if (error) throw error
      }

      setShowDistributionModal(false)
      setDistributingExpense(null)
      setDistributions({})
      fetchExpenses()
      alert('Разпределението е запазено успешно!')
    } catch (error: any) {
      alert(error.message || 'Грешка при запазване на разпределението')
    }
  }

  const autoDistribute = (method: DistributionMethod) => {
    if (!distributingExpense) return

    const newDistributions: Record<string, number> = {}

    if (method === 'equal') {
      const amountPerUnit = distributingExpense.amount / units.length
      units.forEach((unit) => {
        newDistributions[unit.id] = amountPerUnit
      })
    } else if (method === 'by_area') {
      const totalArea = units.reduce((sum, unit) => sum + unit.area, 0)
      units.forEach((unit) => {
        newDistributions[unit.id] = (distributingExpense.amount * unit.area) / totalArea
      })
    }

    setDistributions(newDistributions)
  }

  const getUnitDisplay = (unit: Unit) => {
    const typeLabels: Record<string, string> = {
      apartment: 'Ап.',
      garage: 'Гар.',
      shop: 'Маг.',
      parking: 'Парк.',
    }
    return `${typeLabels[unit.type] || unit.type} ${unit.number}`
  }

  const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0)
  const expensesByCategory = expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.amount
    return acc
  }, {} as Record<string, number>)

  const totalDistributed = Object.values(distributions).reduce((sum, amount) => sum + amount, 0)

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="expenses-page">
      <div className="page-header">
        <div>
          <h1>Разходи</h1>
          <p>Управление на разходи</p>
        </div>
        {canEdit() && (
          <button className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави разход
          </button>
        )}
      </div>

      <div className="summary-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}>
        <div className="summary-card">
          <h3>Общо разходи</h3>
          <div className="summary-amount">{totalExpenses.toFixed(2)} лв</div>
        </div>
        {Object.entries(expensesByCategory).map(([category, amount]) => (
          <div key={category} className="summary-card">
            <h3>{category}</h3>
            <div className="summary-amount">{amount.toFixed(2)} лв</div>
          </div>
        ))}
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Описание</th>
              <th>Категория</th>
              <th>Метод</th>
              <th>Разпределено</th>
              <th>Сума</th>
              {canEdit() && <th>Действия</th>}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr>
                <td colSpan={canEdit() ? 7 : 6} className="empty-cell">
                  Няма регистрирани разходи
                </td>
              </tr>
            ) : (
              expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>
                    {format(new Date(expense.date), 'dd.MM.yyyy', { locale: bg })}
                  </td>
                  <td>{expense.description}</td>
                  <td>
                    <span className="category-badge">{expense.category}</span>
                  </td>
                  <td>{distributionMethodLabels[expense.distribution_method]}</td>
                  <td>
                    {expense.distributions_count > 0 ? (
                      <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CheckCircle2 size={16} />
                        {expense.distributions_count} единици
                      </span>
                    ) : (
                      <span style={{ color: '#ef4444' }}>Неразпределено</span>
                    )}
                  </td>
                  <td className="amount-cell">{expense.amount.toFixed(2)} лв</td>
                  {canEdit() && (
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-btn"
                          onClick={() => openDistributionModal(expense)}
                          title="Осчетоводи"
                        >
                          <Calculator size={18} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => handleEdit(expense)}
                          title="Редактирай"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={() => handleDelete(expense.id)}
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
            <h2>{editingExpense ? 'Редактирай разход' : 'Добави разход'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Сума (лв) *</label>
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
                <label>Категория *</label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  required
                >
                  <option value="">Избери категория</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
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
                <label>Метод на разпределение *</label>
                <select
                  value={formData.distribution_method}
                  onChange={(e) =>
                    setFormData({ ...formData, distribution_method: e.target.value as DistributionMethod })
                  }
                  required
                >
                  <option value="equal">Равно</option>
                  <option value="by_area">По площ</option>
                  <option value="manual">Ръчно</option>
                </select>
                <small style={{ color: '#666', fontSize: '12px' }}>
                  {formData.distribution_method === 'equal' && 'Разходът ще се разпредели равно между всички единици'}
                  {formData.distribution_method === 'by_area' && 'Разходът ще се разпредели пропорционално според площта на единиците'}
                  {formData.distribution_method === 'manual' && 'Ще можете да разпределите разхода ръчно след създаване'}
                </small>
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

      {showDistributionModal && distributingExpense && (
        <div className="modal-overlay" onClick={() => setShowDistributionModal(false)}>
          <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h2>Осчетоводяване: {distributingExpense.description}</h2>
            <p>Обща сума: <strong>{distributingExpense.amount.toFixed(2)} лв</strong></p>
            
            <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => autoDistribute('equal')}
              >
                Равно разпределение
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => autoDistribute('by_area')}
              >
                По площ
              </button>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <strong>Разпределено: {totalDistributed.toFixed(2)} лв / {distributingExpense.amount.toFixed(2)} лв</strong>
              {Math.abs(totalDistributed - distributingExpense.amount) > 0.01 && (
                <span style={{ color: '#ef4444', marginLeft: '10px' }}>
                  Разлика: {(totalDistributed - distributingExpense.amount).toFixed(2)} лв
                </span>
              )}
            </div>

            <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #ddd', borderRadius: '4px', padding: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd' }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Единица</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Собственик</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Площ (м²)</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>Сума (лв)</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px' }}>{getUnitDisplay(unit)}</td>
                      <td style={{ padding: '8px' }}>{unit.owner_name}</td>
                      <td style={{ padding: '8px' }}>{unit.area.toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          value={distributions[unit.id]?.toFixed(2) || '0.00'}
                          onChange={(e) => {
                            const newDistributions = { ...distributions }
                            newDistributions[unit.id] = parseFloat(e.target.value) || 0
                            setDistributions(newDistributions)
                          }}
                          style={{ width: '100px', textAlign: 'right', padding: '4px' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowDistributionModal(false)
                  setDistributingExpense(null)
                  setDistributions({})
                }}
              >
                Отказ
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleDistributionSubmit}
                disabled={Math.abs(totalDistributed - distributingExpense.amount) > 0.01}
              >
                Запази разпределението
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
