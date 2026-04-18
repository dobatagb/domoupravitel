import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import { supabase, supabaseQuery } from '../lib/supabase'
import { IncomeRecords } from './Income'
import Expenses from './Expenses'
import './Income.css'
import './Expenses.css'

export default function Finances() {
  const [year, setYear] = useState<FinanceYearScope>(() => new Date().getFullYear())
  const [tab, setTab] = useState<'income' | 'expenses'>('income')
  const [incomeSum, setIncomeSum] = useState(0)
  const [expenseSum, setExpenseSum] = useState(0)

  useEffect(() => {
    const load = async () => {
      let iq = supabase.from('income').select('amount')
      let eq = supabase.from('expenses').select('amount')
      if (year !== 'all') {
        const a = `${year}-01-01`
        const b = `${year}-12-31`
        iq = iq.gte('date', a).lte('date', b)
        eq = eq.gte('date', a).lte('date', b)
      }
      const [ir, er] = await Promise.all([supabaseQuery(() => iq), supabaseQuery(() => eq)])
      const isum = (ir.data as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0
      const esum = (er.data as { amount: number }[] | null)?.reduce((s, r) => s + Number(r.amount), 0) ?? 0
      setIncomeSum(isum)
      setExpenseSum(esum)
    }
    void load()
  }, [year])

  const balance = incomeSum - expenseSum
  const tabBtn = (active: boolean) =>
    ({
      padding: '0.5rem 1rem',
      border: 'none',
      borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
      background: 'none',
      cursor: 'pointer',
      fontWeight: active ? 600 : 400,
      color: active ? 'var(--primary)' : 'var(--text)',
      marginBottom: '-1px',
    }) as const

  return (
    <div className="income-page">
      <div className="page-header">
        <div>
          <h1>
            <Wallet size={28} style={{ verticalAlign: 'middle', marginRight: 8 }} aria-hidden />
            Финанси
          </h1>
          <p>Приходи и разходи на едно място с обобщение по избрана календарна година.</p>
        </div>
      </div>

      <div className="page-toolbar">
        <YearScopeSelect value={year} onChange={setYear} id="finances-year" />
      </div>

      <div
        className="income-summary-cards"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        <div className="summary-card">
          <h3>Приходи {year === 'all' ? '' : `(${year})`}</h3>
          <div className="summary-amount" style={{ color: 'var(--success)' }}>
            {incomeSum.toFixed(2)} €
          </div>
        </div>
        <div className="summary-card">
          <h3>Разходи {year === 'all' ? '' : `(${year})`}</h3>
          <div className="summary-amount" style={{ color: 'var(--danger)' }}>
            {expenseSum.toFixed(2)} €
          </div>
        </div>
        <div className="summary-card">
          <h3>Баланс (приходи − разходи)</h3>
          <div className="summary-amount">{balance.toFixed(2)} €</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem' }}>
        <button type="button" style={tabBtn(tab === 'income')} onClick={() => setTab('income')}>
          Приходи
        </button>
        <button type="button" style={tabBtn(tab === 'expenses')} onClick={() => setTab('expenses')}>
          Разходи
        </button>
      </div>

      {tab === 'income' ? <IncomeRecords year={year} embedded /> : <Expenses yearScope={year} embedded />}
    </div>
  )
}
