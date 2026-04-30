import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Download, History } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { paymentDescriptionWithMethod } from '../lib/paymentDescription'
import { EXPENSE_CATEGORY_OPTIONS } from '../lib/expenseCategories'
import { sortUnitsByTypeAndNumber } from '../lib/unitNumber'
import './Movements.css'

type MovementKind = 'in' | 'out'

interface MovementRow {
  id: string
  kind: MovementKind
  date: string | null
  label: string
  amount: number
  /** Като в «Задължения» за плащания; за разходи — кратък контекст */
  obligationText: string
  detail: string
  recorderEmail: string | null
  sortTs: number
  /** Разход: категория като в «Добави разход». Постъпление: обект и периоди (от приспадания и/или дати). */
  expenseCategory: string | null
  unitId: string | null
  /** Празно = неизвестен период за филтъра «Стари». Иначе id от billing_periods. */
  billingPeriodIds: string[]
}

const PAGE_SIZE = 25

/** В multi-select за период: редове без съвпадение с billing_periods */
const FILTER_NONE_PERIOD = '__filter_none_period__'
/** В multi-select за обект: приход/плащане без избран обект */
const FILTER_NONE_UNIT = '__filter_none_unit__'

type BillingPeriodMeta = { id: string; date_from: string; date_to: string }

function dateRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = aStart.slice(0, 10)
  const ae = aEnd.slice(0, 10)
  const bs = bStart.slice(0, 10)
  const be = bEnd.slice(0, 10)
  return as <= be && ae >= bs
}

/** Съпоставяне на приход/плащане с периоди по припокриване на интервали (реалните дати често не съвпадат 1:1). */
function billingPeriodIdsFromDateOverlap(
  periods: BillingPeriodMeta[],
  start: string | null | undefined,
  end: string | null | undefined
): string[] {
  if (!start || !end) return []
  const ps = String(start).slice(0, 10)
  const pe = String(end).slice(0, 10)
  const out: string[] = []
  for (const bp of periods) {
    const df = String(bp.date_from).slice(0, 10)
    const dt = String(bp.date_to).slice(0, 10)
    if (dateRangesOverlap(ps, pe, df, dt)) out.push(bp.id)
  }
  return out
}

function uniqueStrings(ids: Iterable<string>): string[] {
  return [...new Set(ids)]
}

const INCOME_TYPE_LABELS: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Паркомясто',
  other: 'Други приходи',
}

export default function Movements() {
  const { user, userRole } = useAuth()
  const isAdmin = userRole === 'admin'
  const [rows, setRows] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterKind, setFilterKind] = useState<'all' | 'in' | 'out'>('all')
  const [page, setPage] = useState(1)
  const [filterExpenseCategory, setFilterExpenseCategory] = useState('')
  const [filterPeriodIds, setFilterPeriodIds] = useState<string[]>([])
  const [filterUnitIds, setFilterUnitIds] = useState<string[]>([])
  const [billingPeriodOptions, setBillingPeriodOptions] = useState<{ id: string; name: string }[]>([])
  const [unitFilterOptions, setUnitFilterOptions] = useState<
    Array<{
      id: string
      type?: string
      number: string
      owner_name: string | null
      group: { name: string | null } | null
    }>
  >([])

  const togglePeriodFilter = (id: string) => {
    setFilterPeriodIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const toggleUnitFilter = (id: string) => {
    setFilterUnitIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        { data: pays, error: pe },
        { data: exps, error: ee },
        { data: incomes, error: incomeErr },
        { data: bpRows, error: bpErr },
        { data: unitRows, error: unitErr },
      ] = await Promise.all([
        supabaseQuery(() =>
          supabase
            .from('payments')
            .select(
              `id, unit_id, amount, payment_date, period_start, period_end, created_at, created_by, notes, status, payment_method,
               payment_allocations ( amount, unit_obligations ( title, kind, billing_period_id ) ),
               income:income_id ( type, description, date, period_start, period_end ),
               units ( number, group:group_id (name) )`
            )
            .order('created_at', { ascending: false })
            .limit(800)
        ),
        supabaseQuery(() =>
          supabase
            .from('expenses')
            .select('id, amount, date, description, category, created_at, created_by')
            .order('date', { ascending: false })
            .limit(800)
        ),
        supabaseQuery(() =>
          supabase
            .from('income')
            .select(
              'id, unit_id, amount, date, description, type, created_at, received_to, period_start, period_end, units:unit_id ( number, group:group_id (name) )'
            )
            .order('date', { ascending: false })
            .limit(800)
        ),
        supabaseQuery(() =>
          supabase
            .from('billing_periods')
            .select('id, name, date_from, date_to')
            .order('sort_order', { ascending: true })
        ),
        supabaseQuery(() =>
          supabase.from('units').select('id, type, number, owner_name, group:group_id (name)').eq('archived', false)
        ),
      ])
      if (pe) throw pe
      if (ee) throw ee
      if (incomeErr) throw incomeErr
      if (bpErr) console.warn('Movements: billing_periods', bpErr)
      if (unitErr) console.warn('Movements: units', unitErr)

      const bpMeta = (bpRows || []) as BillingPeriodMeta[]
      setBillingPeriodOptions(
        (bpRows || []).map((r: { id: string; name: string }) => ({
          id: r.id,
          name: r.name,
        }))
      )
      const rawUnits =
        (unitRows || []) as Array<{
          id: string
          type?: string
          number: string
          owner_name: string | null
          group: { name: string | null } | null
        }>
      setUnitFilterOptions(sortUnitsByTypeAndNumber(rawUnits))

      const uidSet = new Set<string>()
      for (const p of pays || []) {
        const c = (p as { created_by?: string | null }).created_by
        if (c) uidSet.add(c)
      }
      for (const x of exps || []) {
        const c = (x as { created_by?: string | null }).created_by
        if (c) uidSet.add(c)
      }
      const ids = [...uidSet]
      let emailById: Record<string, string> = {}
      if (ids.length > 0) {
        const { data: users, error: ue } = await supabaseQuery(() =>
          supabase.from('users').select('id, email').in('id', ids)
        )
        if (ue) throw ue
        for (const u of users || []) {
          const r = u as { id: string; email: string }
          emailById[r.id] = r.email
        }
      }

      const out: MovementRow[] = []

      for (const raw of pays || []) {
        const p = raw as Record<string, unknown>
        const u = p.units as
          | { number: string; group: { name: string } | { name: string }[] | null }
          | { number: string; group: { name: string } | { name: string }[] | null }[]
          | null
          | undefined
        const unit = Array.isArray(u) ? u[0] : u
        const g = unit?.group
        const gname = Array.isArray(g) ? g[0]?.name : g?.name
        const unitLabel = gname ? `${gname} ${unit?.number ?? ''}`.trim() : `Обект ${unit?.number ?? ''}`
        const paymentDate = p.payment_date as string | null
        const createdAt = p.created_at as string
        const dateStr = paymentDate ?? createdAt?.slice(0, 10) ?? null
        const t = dateStr ? new Date(dateStr).getTime() : 0
        const pid = p.id as string
        const amt = Number(p.amount) || 0
        const status = String(p.status ?? '')
        const notes = (p.notes as string | null)?.trim() ?? ''
        const createdBy = p.created_by as string | null | undefined
        const paymentMethod = p.payment_method as string | null | undefined
        const allocs = p.payment_allocations as
          | {
              amount: number | string
              unit_obligations: { title: string; kind: string; billing_period_id?: string | null } | null
            }[]
          | null
        const income = p.income as {
          type: string
          description: string
          date: string
          period_start: string | null
          period_end: string | null
        } | null
        const obligationText = paymentDescriptionWithMethod(
          { income, payment_allocations: allocs, notes: p.notes as string | null },
          paymentMethod ?? null
        )
        const unitId = (p.unit_id as string | null | undefined) ?? null
        const fromAllocs: string[] = []
        for (const a of allocs || []) {
          const bid = a?.unit_obligations?.billing_period_id
          if (bid && typeof bid === 'string') fromAllocs.push(bid)
        }
        const billingPeriodIds = uniqueStrings([
          ...fromAllocs,
          ...billingPeriodIdsFromDateOverlap(bpMeta, income?.period_start, income?.period_end),
          ...billingPeriodIdsFromDateOverlap(
            bpMeta,
            p.period_start as string | null | undefined,
            p.period_end as string | null | undefined
          ),
        ])
        out.push({
          id: `p-${pid}`,
          kind: 'in',
          date: dateStr,
          label: 'Постъпило плащане',
          amount: amt,
          obligationText,
          detail: [unitLabel, status === 'paid' ? 'платено' : status, notes].filter(Boolean).join(' · '),
          recorderEmail: createdBy ? emailById[createdBy] ?? null : null,
          sortTs: t,
          expenseCategory: null,
          unitId,
          billingPeriodIds,
        })
      }

      for (const raw of exps || []) {
        const x = raw as {
          id: string
          amount: number
          date: string
          description: string
          category: string
          created_at: string
          created_by?: string | null
        }
        const dateStr = x.date
        const t = dateStr ? new Date(dateStr).getTime() : 0
        out.push({
          id: `e-${x.id}`,
          kind: 'out',
          date: dateStr,
          label: 'Разход',
          amount: Number(x.amount) || 0,
          obligationText: [x.category, x.description].filter(Boolean).join(': '),
          detail: `${x.category}: ${x.description}`,
          recorderEmail: x.created_by ? emailById[x.created_by] ?? null : null,
          sortTs: t,
          expenseCategory: x.category || null,
          unitId: null,
          billingPeriodIds: [],
        })
      }

      for (const raw of incomes || []) {
        const x = raw as {
          id: string
          unit_id: string | null
          period_start: string | null
          period_end: string | null
          amount: number
          date: string
          description: string
          type: string
          created_at: string
          received_to?: string | null
          units:
            | { number: string; group: { name: string } | { name: string }[] | null }
            | { number: string; group: { name: string } | { name: string }[] | null }[]
            | null
            | undefined
        }
        const uu = Array.isArray(x.units) ? x.units[0] : x.units
        const g = uu?.group
        const gname = Array.isArray(g) ? g[0]?.name : g?.name
        const unitPart = uu?.number ? (gname ? `${gname} ${uu.number}`.trim() : String(uu.number)) : ''
        const dateStr = x.date
        const t = dateStr ? new Date(dateStr).getTime() : 0
        const typeLab = INCOME_TYPE_LABELS[x.type] ?? x.type
        const rto = (x.received_to ?? 'cash').toString().toLowerCase()
        const to =
          rto === 'bank_transfer' ? 'в сметката' : rto === 'repair_fund' ? 'във фонд ремонт' : 'в касата'
        const unitId = x.unit_id ?? null
        const billingPeriodIds = uniqueStrings(
          billingPeriodIdsFromDateOverlap(bpMeta, x.period_start, x.period_end)
        )
        out.push({
          id: `i-${x.id}`,
          kind: 'in',
          date: dateStr,
          label: 'Приход',
          amount: Number(x.amount) || 0,
          obligationText: `${typeLab}: ${x.description} (${to})`,
          detail: unitPart || '—',
          recorderEmail: null,
          sortTs: t,
          expenseCategory: null,
          unitId,
          billingPeriodIds,
        })
      }

      out.sort((a, b) => b.sortTs - a.sortTs)
      setRows(out)
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Грешка при зареждане'
      setError(
        msg.includes('created_by') || msg.includes('column')
          ? `${msg}\n\nИзпълни database_migrations/028_payments_expenses_created_by.sql в Supabase.`
          : msg
      )
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void load()
  }, [user, load])

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterKind !== 'all' && r.kind !== filterKind) return false
      if (!r.date) return true
      const t = r.date
      if (filterDateFrom && t < filterDateFrom) return false
      if (filterDateTo && t > filterDateTo) return false

      if (filterKind === 'out' && filterExpenseCategory) {
        if (r.expenseCategory !== filterExpenseCategory) return false
      }

      if (filterKind === 'in') {
        if (filterPeriodIds.length > 0) {
          const wantsNone = filterPeriodIds.includes(FILTER_NONE_PERIOD)
          const selectedBp = filterPeriodIds.filter((id) => id !== FILTER_NONE_PERIOD)
          const rowPeriods = r.billingPeriodIds
          const matchesAllocatedPeriod =
            selectedBp.length > 0 && rowPeriods.some((pid) => selectedBp.includes(pid))
          const matchesNoPeriod = wantsNone && rowPeriods.length === 0
          if (!matchesAllocatedPeriod && !matchesNoPeriod) return false
        }
        if (filterUnitIds.length > 0) {
          const okUnit =
            (r.unitId != null && filterUnitIds.includes(r.unitId)) ||
            (r.unitId == null && filterUnitIds.includes(FILTER_NONE_UNIT))
          if (!okUnit) return false
        }
      }

      return true
    })
  }, [
    rows,
    filterKind,
    filterDateFrom,
    filterDateTo,
    filterExpenseCategory,
    filterPeriodIds,
    filterUnitIds,
  ])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRows, safePage]
  )

  const sumColumnTotals = useMemo(() => {
    let sumIn = 0
    let sumOut = 0
    for (const r of filteredRows) {
      if (r.kind === 'in') sumIn += r.amount
      else sumOut += r.amount
    }
    const net = sumIn - sumOut
    return { sumIn, sumOut, net }
  }, [filteredRows])

  useEffect(() => {
    setFilterExpenseCategory('')
    setFilterPeriodIds([])
    setFilterUnitIds([])
  }, [filterKind])

  useEffect(() => {
    setPage(1)
  }, [
    filterDateFrom,
    filterDateTo,
    filterKind,
    filterExpenseCategory,
    filterPeriodIds.join('|'),
    filterUnitIds.join('|'),
  ])

  const exportFilteredCsv = () => {
    if (!isAdmin) return
    const esc = (s: string) => {
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const header = ['Дата', 'Вид', 'Сума (€)', 'Описание (приспадане / начин)', 'Контекст', 'Записал']
    const lines: string[] = [header.map(esc).join(',')]
    for (const r of filteredRows) {
      const d = r.date ? format(new Date(r.date), 'yyyy-MM-dd') : ''
      const k = r.kind === 'in' ? 'Постъпление' : 'Разход'
      const amt = (r.kind === 'in' ? 1 : -1) * r.amount
      lines.push(
        [d, k, amt.toFixed(2), r.obligationText, r.detail, r.recorderEmail ?? ''].map(esc).join(','),
      )
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dvizheniya-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="movements-page">
      <div className="movements-head">
        <h1>
          <History size={28} className="movements-icon" aria-hidden />
          Движения
        </h1>
        <p className="movements-sub">
          Обединен преглед на плащания от «Задължения», <strong>приходи</strong> (други приходи) и разходи. Колоната
          „Записал“ за плащания/разходи — след миграция 028; приходите нямат поле за записал.
        </p>
      </div>

      {error && (
        <div className="movements-error" role="alert">
          <p style={{ whiteSpace: 'pre-wrap' }}>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Опитай отново
          </button>
        </div>
      )}

      <div className="movements-filters">
        <div className="movements-filters-row">
          <div className="movements-filter-group">
            <label htmlFor="mov-d1">Дата от</label>
            <input
              id="mov-d1"
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="movements-filter-input"
            />
          </div>
          <div className="movements-filter-group">
            <label htmlFor="mov-d2">Дата до</label>
            <input
              id="mov-d2"
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="movements-filter-input"
            />
          </div>
          <div className="movements-filter-group">
            <label htmlFor="mov-kind">Вид</label>
            <select
              id="mov-kind"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as 'all' | 'in' | 'out')}
              className="movements-filter-input"
            >
              <option value="all">Всички</option>
              <option value="in">Постъпления</option>
              <option value="out">Разходи</option>
            </select>
          </div>
          <div className="movements-filters-right">
            <div className="movements-filter-hint">
              {filteredRows.length} записа
              {pageCount > 1 ? ` · стр. ${safePage} / ${pageCount}` : ''}
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-secondary movements-export-btn"
                onClick={exportFilteredCsv}
                disabled={filteredRows.length === 0}
                title="Експорт в CSV (UTF-8) — само за администратор"
              >
                <Download size={18} aria-hidden />
                Експорт
              </button>
            )}
          </div>
        </div>

        {filterKind === 'out' && (
          <div className="movements-filters-row">
            <div className="movements-filter-group">
              <label htmlFor="mov-exp-cat">Категория</label>
              <select
                id="mov-exp-cat"
                value={filterExpenseCategory}
                onChange={(e) => setFilterExpenseCategory(e.target.value)}
                className="movements-filter-input movements-filter-input--wide"
              >
                <option value="">Всички</option>
                {EXPENSE_CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {filterKind === 'in' && (
          <>
            <p className="movements-filter-multi-hint">
              За период и обект: маркирай една или повече стойности; празен избор означава „всички“. За редове без
              съвпадение с период от «Периоди» ползвай „Стари“; приход без обект — „Без обект“.
            </p>
            <div className="movements-filters-row movements-filters-row--checkboxes">
              <fieldset className="movements-filter-fieldset">
                <legend>Период</legend>
                <div className="movements-filter-checkbox-grid">
                  <label className="movements-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={filterPeriodIds.includes(FILTER_NONE_PERIOD)}
                      onChange={() => togglePeriodFilter(FILTER_NONE_PERIOD)}
                    />
                    Стари
                  </label>
                  {billingPeriodOptions.map((bp) => (
                    <label key={bp.id} className="movements-filter-checkbox">
                      <input
                        type="checkbox"
                        checked={filterPeriodIds.includes(bp.id)}
                        onChange={() => togglePeriodFilter(bp.id)}
                      />
                      {bp.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="movements-filter-fieldset">
                <legend>Обект</legend>
                <div className="movements-filter-checkbox-grid">
                  <label className="movements-filter-checkbox">
                    <input
                      type="checkbox"
                      checked={filterUnitIds.includes(FILTER_NONE_UNIT)}
                      onChange={() => toggleUnitFilter(FILTER_NONE_UNIT)}
                    />
                    Без обект
                  </label>
                  {unitFilterOptions.map((u) => (
                    <label key={u.id} className="movements-filter-checkbox">
                      <input
                        type="checkbox"
                        checked={filterUnitIds.includes(u.id)}
                        onChange={() => toggleUnitFilter(u.id)}
                      />
                      {[u.group?.name, u.number].filter(Boolean).join(' ')}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </>
        )}
      </div>

      {filteredRows.length > 0 && (
        <div className="movements-sum-summary" role="status" aria-live="polite">
          <span className="movements-sum-summary-label">
            Сума по колона „Сума“ за филтрираните редове ({filteredRows.length}{' '}
            {filteredRows.length === 1 ? 'запис' : 'записа'}, всички страници):
          </span>
          {filterKind === 'all' && (
            <span className="movements-sum-summary-values">
              <span className="movements-sum-pill movements-sum-pill--in">
                Постъпления +{sumColumnTotals.sumIn.toFixed(2)} €
              </span>
              <span className="movements-sum-pill movements-sum-pill--out">
                Разходи −{sumColumnTotals.sumOut.toFixed(2)} €
              </span>
              <span
                className={`movements-sum-pill movements-sum-pill--net${sumColumnTotals.net >= 0 ? ' movements-sum-pill--net-pos' : ' movements-sum-pill--net-neg'}`}
              >
                Нето {sumColumnTotals.net >= 0 ? '+' : ''}
                {sumColumnTotals.net.toFixed(2)} €
              </span>
            </span>
          )}
          {filterKind === 'in' && (
            <span className="movements-sum-summary-values">
              <span className="movements-sum-pill movements-sum-pill--in">
                +{sumColumnTotals.sumIn.toFixed(2)} €
              </span>
            </span>
          )}
          {filterKind === 'out' && (
            <span className="movements-sum-summary-values">
              <span className="movements-sum-pill movements-sum-pill--out">
                −{sumColumnTotals.sumOut.toFixed(2)} €
              </span>
            </span>
          )}
        </div>
      )}

      {rows.length === 0 && !error ? (
        <p className="movements-muted">Няма записи.</p>
      ) : (
        <div className="table-wrap movements-table-wrap">
          {filteredRows.length === 0 && (
            <p className="movements-muted" style={{ padding: '1rem' }}>
              Няма записи за избраните филтри.
            </p>
          )}
          <table className="movements-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Вид</th>
                <th className="num">Сума (€)</th>
                <th>Описание</th>
                <th>Контекст</th>
                <th>Записал</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.date
                      ? format(new Date(r.date), 'dd.MM.yyyy', { locale: bg })
                      : '—'}
                  </td>
                  <td>{r.kind === 'in' ? 'Постъпление' : 'Разход'}</td>
                  <td className={`num ${r.kind === 'in' ? 'amt-in' : 'amt-out'}`}>
                    {r.kind === 'in' ? '+' : '−'}
                    {r.amount.toFixed(2)}
                  </td>
                  <td className="movements-obligation-col">{r.obligationText}</td>
                  <td>{r.detail}</td>
                  <td className="movements-recorder">{r.recorderEmail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && !error && pageCount > 1 && (
        <div className="movements-pager">
          <button
            type="button"
            className="btn-secondary"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </button>
          <span className="movements-pager-info">
            {safePage} / {pageCount}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Напред
          </button>
        </div>
      )}
    </div>
  )
}
