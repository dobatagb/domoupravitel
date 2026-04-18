import './YearScopeSelect.css'

export type FinanceYearScope = number | 'all'

type Props = {
  value: FinanceYearScope
  onChange: (value: FinanceYearScope) => void
  id?: string
  className?: string
}

const START_YEAR = 2020

function yearOptions(): number[] {
  const y = new Date().getFullYear()
  const end = Math.max(y, START_YEAR)
  const out: number[] = []
  for (let i = end; i >= START_YEAR; i--) out.push(i)
  return out
}

export default function YearScopeSelect({ value, onChange, id = 'finance-year-scope', className }: Props) {
  const opts = yearOptions()
  return (
    <div className={`year-scope-select ${className ?? ''}`.trim()}>
      <label htmlFor={id}>Период</label>
      <select
        id={id}
        value={value === 'all' ? 'all' : String(value)}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === 'all' ? 'all' : parseInt(v, 10))
        }}
      >
        <option value="all">Всички години</option>
        {opts.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}
