import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import { IncomeRecords } from './Income'
import Expenses from './Expenses'
import FinancesLiquidity from './FinancesLiquidity'
import './Income.css'
import './Expenses.css'

export default function Finances() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [year, setYear] = useState<FinanceYearScope>(() => new Date().getFullYear())
  const [tab, setTab] = useState<'liquidity' | 'income' | 'expenses'>('liquidity')

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'expenses' || t === 'income' || t === 'liquidity') {
      setTab(t)
    }
  }, [searchParams])

  const goTab = (next: 'liquidity' | 'income' | 'expenses') => {
    setTab(next)
    if (next === 'liquidity') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ tab: next }, { replace: true })
    }
  }

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
            <strong>Налични пари</strong> — баланс по <strong>каса (в брой)</strong>, <strong>сметка</strong> и{' '}
            <strong>фонд ремонт</strong>, изчислен от приходи, плащания в «Задължения» (само каса/сметка) и разходи
            (миграции 056–058). Табовете «Други приходи» / «Разходи» — по година, с избор на каса, сметка или фонд. Такси
            от собственици — през <strong>Задължения</strong> (плащания).
          </p>
        </div>
      </div>

      {tab !== 'liquidity' && (
        <div className="page-toolbar">
          <YearScopeSelect value={year} onChange={setYear} id="finances-year" />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '1.25rem' }}>
        <button type="button" style={tabBtn(tab === 'liquidity')} onClick={() => goTab('liquidity')}>
          Налични пари
        </button>
        <button type="button" style={tabBtn(tab === 'income')} onClick={() => goTab('income')}>
          Други приходи
        </button>
        <button type="button" style={tabBtn(tab === 'expenses')} onClick={() => goTab('expenses')}>
          Разходи
        </button>
      </div>

      {tab === 'liquidity' && <FinancesLiquidity />}
      {tab === 'income' && <IncomeRecords year={year} embedded />}
      {tab === 'expenses' && <Expenses yearScope={year} embedded />}
    </div>
  )
}
