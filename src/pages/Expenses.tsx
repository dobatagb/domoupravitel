import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { openPublicStorageInNewTab, rawBodyForStorageUpload, sanitizeStorageFileName } from '../lib/storageUpload'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Edit2, Trash2, FileText, Paperclip } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import './Expenses.css'

interface Expense {
  id: string
  amount: number
  description: string
  date: string
  category: string
  created_at: string
  document_path?: string | null
  document_name?: string | null
  /** cash = каса, bank_transfer = сметка (след миграция 050) */
  paid_from?: 'cash' | 'bank_transfer' | null
}

const categories = [
  'Поддръжка и ремонт',
  'Комунални услуги',
  'Почистване',
  'Осигуровки',
  'Управление',
  'Вътрешно прехвърляне',
  'Други',
]

/** Колоната в БД остава за стари данни; новите разходи винаги се записват като equal. */
const EXPENSE_DISTRIBUTION_LEGACY = 'equal' as const

async function removeStorageObjectAt(path: string | null | undefined) {
  if (!path?.trim()) return
  const { error } = await supabase.storage.from('documents').remove([path])
  if (error) console.warn('Премахване от хранилище:', error.message)
}

function expenseDocumentPublicUrl(path: string | null | undefined): string | null {
  if (!path?.trim()) return null
  const { data } = supabase.storage.from('documents').getPublicUrl(path)
  return data.publicUrl
}

type ExpensesProps = {
  /** Ако е подадено (напр. от страницата „Финанси“), филтърът по година се контролира отвън */
  yearScope?: FinanceYearScope
  /** Скрива заглавието и собствения селектор за година */
  embedded?: boolean
}

export default function Expenses({ yearScope: controlledYear, embedded = false }: ExpensesProps = {}) {
  const { canEdit } = useAuth()
  const [localYear, setLocalYear] = useState<FinanceYearScope>(() => new Date().getFullYear())
  const yearFilter = controlledYear !== undefined ? controlledYear : localYear

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [formData, setFormData] = useState({
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: '',
    paid_from: 'cash' as 'cash' | 'bank_transfer',
  })
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null)
  const [removeAttachment, setRemoveAttachment] = useState(false)

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase.from('expenses').select('*').order('date', { ascending: false })
      if (yearFilter !== 'all') {
        q = q.gte('date', `${yearFilter}-01-01`).lte('date', `${yearFilter}-12-31`)
      }
      const { data, error } = await supabaseQuery(() => q)

      if (error) throw error
      setExpenses((data as Expense[]) || [])
    } catch (error) {
      console.error('Error fetching expenses:', error)
    } finally {
      setLoading(false)
    }
  }, [yearFilter])

  useEffect(() => {
    void fetchExpenses()
  }, [fetchExpenses])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (pendingAttachment && pendingAttachment.size > 10 * 1024 * 1024) {
        alert('Файлът е по-голям от 10 MB. Качи по-малък файл.')
        return
      }

      const expenseData = {
        amount: parseFloat(formData.amount),
        description: formData.description.trim(),
        date: formData.date,
        category: formData.category,
        distribution_method: EXPENSE_DISTRIBUTION_LEGACY,
        paid_from: formData.paid_from,
      }

      if (editingExpense) {
        const { error } = await supabase.from('expenses').update(expenseData).eq('id', editingExpense.id)
        if (error) throw error

        if (removeAttachment) {
          if (editingExpense.document_path) {
            await removeStorageObjectAt(editingExpense.document_path)
          }
          const { error: cl } = await supabase
            .from('expenses')
            .update({ document_path: null, document_name: null })
            .eq('id', editingExpense.id)
          if (cl) throw cl
        } else if (pendingAttachment) {
          if (editingExpense.document_path) {
            await removeStorageObjectAt(editingExpense.document_path)
          }
          const safe = sanitizeStorageFileName(pendingAttachment.name)
          const storagePath = `expenses/${editingExpense.id}/${crypto.randomUUID()}_${safe}`
          const { body: upBody, contentType: upCt } = await rawBodyForStorageUpload(pendingAttachment)
          const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, upBody, {
            cacheControl: '3600',
            contentType: upCt,
          })
          if (upErr) throw upErr
          const { error: upDb } = await supabase
            .from('expenses')
            .update({ document_path: storagePath, document_name: pendingAttachment.name })
            .eq('id', editingExpense.id)
          if (upDb) throw upDb
        }
      } else {
        const { data: inserted, error } = await supabase.from('expenses').insert(expenseData).select('id').single()
        if (error) throw error
        const newId = inserted?.id as string | undefined
        if (pendingAttachment && newId) {
          const safe = sanitizeStorageFileName(pendingAttachment.name)
          const storagePath = `expenses/${newId}/${crypto.randomUUID()}_${safe}`
          const { body: upBody, contentType: upCt } = await rawBodyForStorageUpload(pendingAttachment)
          const { error: upErr } = await supabase.storage.from('documents').upload(storagePath, upBody, {
            cacheControl: '3600',
            contentType: upCt,
          })
          if (upErr) throw upErr
          const { error: upDb } = await supabase
            .from('expenses')
            .update({ document_path: storagePath, document_name: pendingAttachment.name })
            .eq('id', newId)
          if (upDb) throw upDb
        }
      }

      setShowModal(false)
      setEditingExpense(null)
      setPendingAttachment(null)
      setRemoveAttachment(false)
      resetForm()
      void fetchExpenses()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при запазване'
      alert(
        msg.includes('document_path') || msg.includes('column')
          ? `${msg}\n\nИзпълни database_migrations/029_expenses_document_attachment.sql в Supabase.`
          : msg
      )
    }
  }

  const resetForm = () => {
    setFormData({
      amount: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      category: '',
      paid_from: 'cash',
    })
    setPendingAttachment(null)
    setRemoveAttachment(false)
  }

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense)
    setPendingAttachment(null)
    setRemoveAttachment(false)
    setFormData({
      amount: expense.amount.toString(),
      description: expense.description,
      date: expense.date.split('T')[0],
      category: expense.category,
      paid_from: expense.paid_from === 'bank_transfer' ? 'bank_transfer' : 'cash',
    })
    setShowModal(true)
  }

  const handleDelete = async (expense: Expense) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този разход?')) return

    try {
      if (expense.document_path) {
        await removeStorageObjectAt(expense.document_path)
      }
      const { error } = await supabase.from('expenses').delete().eq('id', expense.id)
      if (error) throw error
      void fetchExpenses()
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Грешка при изтриване')
    }
  }

  const openNewModal = () => {
    setEditingExpense(null)
    resetForm()
    setShowModal(true)
  }

  const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0)
  const expensesByCategory = expenses.reduce(
    (acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount
      return acc
    },
    {} as Record<string, number>
  )

  if (loading) {
    return <div>Зареждане...</div>
  }

  const headerIntro = (
    <>
      При запис избирате дали разходът е от <strong>каса (в брой)</strong> или от <strong>банкова сметка</strong> — сумата се
      намалява от съответната наличност в «Финанси» (след миграция 050). Може да прикачите <strong>фактура или документ</strong>{' '}
      (PDF, снимка).
    </>
  )

  return (
    <div className="expenses-page">
      {!embedded && (
        <div className="page-header">
          <div>
            <h1>Разходи</h1>
            <p>{headerIntro}</p>
          </div>
          {canEdit() && (
            <button type="button" className="btn-primary" onClick={openNewModal}>
              <Plus size={20} />
              Добави разход
            </button>
          )}
        </div>
      )}
      {embedded && canEdit() && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button type="button" className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави разход
          </button>
        </div>
      )}
      {!embedded && (
        <div
          className="page-toolbar"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}
        >
          <YearScopeSelect value={localYear} onChange={setLocalYear} id="expenses-year" />
        </div>
      )}

      <div
        className="summary-cards"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px' }}
      >
        <div className="summary-card">
          <h3>Общо разходи {yearFilter === 'all' ? '' : `(${yearFilter})`}</h3>
          <div className="summary-amount">{totalExpenses.toFixed(2)} €</div>
        </div>
        {Object.entries(expensesByCategory).map(([category, amount]) => (
          <div key={category} className="summary-card">
            <h3>{category}</h3>
            <div className="summary-amount">{amount.toFixed(2)} €</div>
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
              <th>От</th>
              <th>Документ</th>
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
                  <td>{format(new Date(expense.date), 'dd.MM.yyyy', { locale: bg })}</td>
                  <td className={!expense.description?.trim() ? 'expense-desc-empty' : undefined}>
                    {expense.description?.trim() || '—'}
                  </td>
                  <td>
                    <span className="category-badge">{expense.category}</span>
                  </td>
                  <td>
                    {expense.paid_from === 'bank_transfer' ? 'Сметка' : 'Каса'}
                  </td>
                  <td>
                    {expense.document_path ? (
                      <a
                        href={expenseDocumentPublicUrl(expense.document_path) ?? '#'}
                        className="expense-doc-link"
                        onClick={(e) => {
                          e.preventDefault()
                          const path = expense.document_path
                          if (!path) return
                          const url = expenseDocumentPublicUrl(path)
                          if (!url) return
                          const name = expense.document_name?.trim() || path.split('/').pop() || 'file'
                          void openPublicStorageInNewTab(url, name)
                        }}
                      >
                        <FileText size={16} aria-hidden />
                        <span>{expense.document_name?.trim() || 'Преглед'}</span>
                      </a>
                    ) : (
                      <span className="expense-doc-missing">—</span>
                    )}
                  </td>
                  <td className="amount-cell">{expense.amount.toFixed(2)} €</td>
                  {canEdit() && (
                    <td>
                      <div className="table-actions">
                        <button type="button" className="icon-btn" onClick={() => handleEdit(expense)} title="Редактирай">
                          <Edit2 size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => void handleDelete(expense)}
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
                <label>Сума (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="По желание"
                />
              </div>
              <div className="form-group">
                <label>Категория *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
                <input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required />
              </div>
              <div className="form-group">
                <label htmlFor="expense-paid-from">Платено от *</label>
                <select
                  id="expense-paid-from"
                  value={formData.paid_from}
                  onChange={(e) =>
                    setFormData({ ...formData, paid_from: e.target.value as 'cash' | 'bank_transfer' })
                  }
                  required
                >
                  <option value="cash">Каса (в брой)</option>
                  <option value="bank_transfer">Банкова сметка</option>
                </select>
              </div>

              <div className="form-group expense-attachment-group">
                <label htmlFor="expense-file">
                  <Paperclip size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} aria-hidden />
                  Документ (фактура, разписка)
                </label>
                <input
                  id="expense-file"
                  type="file"
                  accept=".pdf,.PDF,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    setPendingAttachment(e.target.files?.[0] ?? null)
                    setRemoveAttachment(false)
                  }}
                />
                <p className="expense-attachment-hint">По избор — PDF или снимка до 10 MB.</p>
                {editingExpense?.document_path && !removeAttachment && (
                  <div className="expense-current-file">
                    <span>Текущ файл: </span>
                    <a
                      href={expenseDocumentPublicUrl(editingExpense.document_path) ?? '#'}
                      onClick={(e) => {
                        e.preventDefault()
                        const url = expenseDocumentPublicUrl(editingExpense.document_path)
                        if (!url || !editingExpense.document_path) return
                        const name =
                          editingExpense.document_name?.trim() ||
                          editingExpense.document_path.split('/').pop() ||
                          'file'
                        void openPublicStorageInNewTab(url, name)
                      }}
                    >
                      {editingExpense.document_name || 'Преглед'}
                    </a>
                    <label className="expense-remove-doc">
                      <input
                        type="checkbox"
                        checked={removeAttachment}
                        onChange={(e) => {
                          setRemoveAttachment(e.target.checked)
                          if (e.target.checked) setPendingAttachment(null)
                        }}
                      />
                      Премахни прикачения файл
                    </label>
                  </div>
                )}
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
