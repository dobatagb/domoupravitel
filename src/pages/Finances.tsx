import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import { supabase, supabaseQuery } from '../lib/supabase'
import { IncomeRecords } from './Income'
import Expenses from './Expenses'
import FinancesLiquidity from './FinancesLiquidity'
import './Income.css'
import './Expenses.css'

export default function Finances() {
  const [year, setYear] = useState<FinanceYearScope>(() => new Date().getFullYear())
  const [tab, setTab] = useState<'liquidity' | 'income' | 'expenses'>('liquidity')
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
          <p>
            <strong>Налични пари</strong> — кеш и сметка (с автоматично увеличение при плащания в брой / банков превод от
            «Задължения», след миграция 049). Останалите табове са по избрана година: други приходи и разходи.
            Постъпленията от такси се записват през <strong>Задължения</strong> (плащания).
          </p>
        </div>
      </div>

      {tab !== 'liquidity' && (
        <div className="page-toolbar">
          <YearScopeSelect value={year} onChange={setYear} id="finances-year" />
        </div>
      )}

      {tab !== 'liquidity' && (
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
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '1.25rem' }}>
        <button type="button" style={tabBtn(tab === 'liquidity')} onClick={() => setTab('liquidity')}>
          Налични пари
        </button>
        <button type="button" style={tabBtn(tab === 'income')} onClick={() => setTab('income')}>
          Други приходи
        </button>
        <button type="button" style={tabBtn(tab === 'expenses')} onClick={() => setTab('expenses')}>
          Разходи
        </button>
      </div>

      {tab === 'liquidity' && <FinancesLiquidity />}
      {tab === 'income' && <IncomeRecords year={year} embedded />}
      {tab === 'expenses' && <Expenses yearScope={year} embedded />}
    </div>
  )
}
