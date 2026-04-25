import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { TrendingUp, TrendingDown, CreditCard, Wallet, Landmark, History, Hammer } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Dashboard.css'
import { loadDueByUnitMap } from '../lib/buildingUnitDues'
import { fetchLedgerDetail } from '../lib/liquidityLedger'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { paymentDescriptionWithMethod } from '../lib/paymentDescription'

type ViewerPaymentRow = {
  id: string
  unitLabel: string
  amount: number
  paymentDate: string | null
  /** Като в «Задължения»: приспадане / приход / в брой */
  description: string
}

export default function Dashboard() {
  const { userRole, user } = useAuth()
  const { labelForCode } = useUnitGroups()
  const isViewer = userRole === 'viewer'
  const [stats, setStats] = useState({
    /** Сума от плащания (payments), статус „платено“ — постъпили в касата от Задължения */
    totalPayments: 0,
    /** Редове от таблица income (Финанси → Други приходи), вкл. начална сума като приход при нужда */
    totalOtherIncome: 0,
    totalExpenses: 0,
  })

  /** Суми от unit_obligations за неархивирани обекти (като агрегата в «Задължения»), без филтър по година. */
  const [obligationTotals, setObligationTotals] = useState({
    charged: 0,
    collected: 0,
    remaining: 0,
  })
  const [liquidBalances, setLiquidBalances] = useState({ cash: 0, bank: 0, repairFund: 0 })

  const [viewerMyDue, setViewerMyDue] = useState(0)
  const [viewerMyPayments, setViewerMyPayments] = useState<ViewerPaymentRow[]>([])
  const [viewerSnapshotLoading, setViewerSnapshotLoading] = useState(false)
  const [viewerHasLinkedUnits, setViewerHasLinkedUnits] = useState(false)
  const [statsYear, setStatsYear] = useState<FinanceYearScope>(() => new Date().getFullYear())

  useEffect(() => {
    if (isViewer) {
      setStatsYear(new Date().getFullYear())
    }
  }, [isViewer])

  useEffect(() => {
    void fetchStats(statsYear)
  }, [statsYear, isViewer])

  useEffect(() => {
    if (!isViewer || !user?.id) {
      setViewerMyDue(0)
      setViewerMyPayments([])
      setViewerHasLinkedUnits(false)
      return
    }
    void fetchViewerSnapshot(user.id)
  }, [isViewer, user?.id])

  function paymentInScope(
    paymentDate: string | null,
    createdAt: string | null | undefined,
    scope: FinanceYearScope
  ): boolean {
    if (scope === 'all') return true
    const d = paymentDate || (createdAt ? createdAt.split('T')[0] : null)
    if (!d) return false
    const y = new Date(d).getFullYear()
    return y === scope
  }

  const fetchStats = async (scope: FinanceYearScope) => {
    try {
      const { data: paymentsData } = await supabase
        .from('payments')
        .select('amount, payment_date, created_at')
        .eq('status', 'paid')
      let totalPayments = 0
      for (const item of paymentsData || []) {
        const row = item as { amount: number | string; payment_date: string | null; created_at?: string }
        if (!paymentInScope(row.payment_date, row.created_at ?? null, scope)) continue
        totalPayments += Number(row.amount) || 0
      }

      let expQuery = supabase.from('expenses').select('amount')
      if (scope !== 'all') {
        expQuery = expQuery.gte('date', `${scope}-01-01`).lte('date', `${scope}-12-31`)
      }
      const { data: expensesData } = await expQuery
      const totalExpenses =
        (expensesData as { amount?: number | null }[] | null | undefined)?.reduce(
          (sum: number, item: { amount?: number | null }) => sum + (Number(item.amount) || 0),
          0,
        ) ?? 0

      let incQuery = supabase.from('income').select('amount')
      if (scope !== 'all') {
        incQuery = incQuery.gte('date', `${scope}-01-01`).lte('date', `${scope}-12-31`)
      }
      const { data: incomeData } = await supabaseQuery(() => incQuery)
      let totalOtherIncome = 0
      for (const row of incomeData || []) {
        const r = row as { amount: number | string }
        totalOtherIncome += Number(r.amount) || 0
      }

      setStats({
        totalPayments,
        totalOtherIncome,
        totalExpenses,
      })

      const [
        { data: oblRows, error: oblErr },
        { data: nonArchivedUnitRows, error: unitsFilterErr },
        ledger,
      ] = await Promise.all([
        supabase.from('unit_obligations').select('unit_id, amount_original, amount_remaining'),
        supabase.from('units').select('id').eq('archived', false),
        fetchLedgerDetail().catch((e: unknown) => {
          console.warn('ledger balances:', e)
          return null
        }),
      ])
      if (unitsFilterErr) {
        console.warn('Dashboard unit filter (archived):', unitsFilterErr)
      }
      const activeUnitIds =
        !unitsFilterErr && nonArchivedUnitRows
          ? new Set((nonArchivedUnitRows as { id: string }[]).map((r) => r.id))
          : null
      if (!oblErr && oblRows) {
        let charged = 0
        let remaining = 0
        for (const raw of oblRows) {
          const r = raw as {
            unit_id: string
            amount_original: number | string
            amount_remaining: number | string
          }
          if (activeUnitIds && !activeUnitIds.has(r.unit_id)) continue
          const o = Number(r.amount_original)
          const rem = Number(r.amount_remaining)
          charged += Number.isFinite(o) ? o : 0
          remaining += Number.isFinite(rem) ? rem : 0
        }
        const collected = Math.round(Math.max(0, charged - remaining) * 100) / 100
        setObligationTotals({
          charged,
          collected,
          remaining,
        })
      } else {
        setObligationTotals({ charged: 0, collected: 0, remaining: 0 })
      }

      if (ledger) {
        setLiquidBalances({ cash: ledger.cash, bank: ledger.bank, repairFund: ledger.repairFund })
      } else {
        setLiquidBalances({ cash: 0, bank: 0, repairFund: 0 })
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }

  const fetchViewerSnapshot = async (userId: string) => {
    setViewerSnapshotLoading(true)
    try {
      const { data: links } = await supabase.from('user_unit_links').select('unit_id').eq('user_id', userId)
      const linkedIds = new Set((links || []).map((r: { unit_id: string }) => r.unit_id))
      setViewerHasLinkedUnits(linkedIds.size > 0)

      const [dueByUnit, { data: pays }] = await Promise.all([
        loadDueByUnitMap(),
        supabase
          .from('payments')
          .select(
            `id, unit_id, amount, payment_date, status, notes, payment_method,
             payment_allocations ( amount, unit_obligations ( title, kind ) ),
             income:income_id ( type, description, date, period_start, period_end )`
          )
          .eq('status', 'paid'),
      ])

      let myDue = 0
      for (const uid of linkedIds) {
        myDue += dueByUnit[uid] ?? 0
      }
      setViewerMyDue(myDue)

      const linkedIdList = [...linkedIds]
      const labelById: Record<string, string> = {}
      if (linkedIdList.length > 0) {
        const { data: linkUnits } = await supabase
          .from('units')
          .select('id, number, floor, type, group:group_id (name)')
          .in('id', linkedIdList)
          .eq('archived', false)
        type UnitRow = {
          id: string
          number: string | number
          floor?: string | null
          type: string
          group: { name?: string } | null
        }
        const unitList = sortUnitsByTypeAndNumber((linkUnits as UnitRow[] | null | undefined) ?? [])
        for (const u of unitList) {
          const ug = u.group?.name ?? labelForCode(u.type)
          const n = formatUnitNumberDisplay(u.number)
          labelById[u.id] = [ug, n].filter(Boolean).join(' ')
        }
      }

      type PayRow = {
        id: string
        unit_id: string
        amount: number | string
        payment_date: string | null
        notes: string | null
        payment_method: string | null
        payment_allocations: {
          amount: number | string
          unit_obligations: { title: string; kind: string } | null
        }[] | null
        income: {
          type: string
          description: string
          date: string
          period_start: string | null
          period_end: string | null
        } | null
      }
      const myPayList: ViewerPaymentRow[] = ((pays || []) as PayRow[])
        .filter((p) => linkedIds.has(p.unit_id))
        .map((p) => {
          const row = p
          const amt = typeof row.amount === 'string' ? parseFloat(row.amount) : Number(row.amount)
          return {
            id: row.id,
            unitLabel: labelById[row.unit_id] ?? row.unit_id,
            amount: Number.isFinite(amt) ? amt : 0,
            paymentDate: row.payment_date,
            description: paymentDescriptionWithMethod(
              {
                income: row.income,
                payment_allocations: row.payment_allocations,
                notes: row.notes,
              },
              row.payment_method
            ),
          }
        })
      myPayList.sort((a, b) => {
        const da = a.paymentDate ? new Date(a.paymentDate).getTime() : 0
        const db = b.paymentDate ? new Date(b.paymentDate).getTime() : 0
        return db - da
      })
      setViewerMyPayments(myPayList)
    } catch (e) {
      console.error('viewer snapshot:', e)
    } finally {
      setViewerSnapshotLoading(false)
    }
  }

  const balance = stats.totalOtherIncome + stats.totalPayments - stats.totalExpenses

  return (
    <div className={`dashboard${isViewer ? ' dashboard--viewer-home' : ''}`}>
      <h1>{isViewer ? 'Табло' : 'Начало'}</h1>
      <p className="dashboard-subtitle">
        {isViewer
          ? 'Преглед на сградата и вашите задължения'
          : 'Информационно табло на етажната собственост — ЕС Ален Мак 22'}
      </p>

      {!isViewer && (
        <div className="dashboard-year-bar" style={{ marginBottom: '1.25rem' }}>
          <YearScopeSelect
            value={statsYear}
            onChange={setStatsYear}
            id="dashboard-stats-year"
          />
          <span className="dashboard-year-hint" style={{ fontSize: '0.8125rem', color: 'var(--text-light)' }}>
            {statsYear === 'all'
              ? 'Показват се всички записи.'
              : `Филтър по календарна година за плащания (дата на плащане), други приходи (дата), разходи и дата на документ.`}
          </span>
        </div>
      )}

      {!isViewer && (
        <div className="dashboard-section dashboard-obligation-snapshot">
          <h2 className="dashboard-section-title">Текущи задължения</h2>
          <p className="dashboard-section-lead">
            Обобщение по всички редове задължения: неплатената част е сумата, която още не е събрана от собствениците.
          </p>
          <div
            className="stats-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
          >
            <div className="stat-card paid">
              <div className="stat-content">
                <div className="stat-label">Събрани</div>
                <div className="stat-value">{obligationTotals.collected.toFixed(2)} €</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-content">
                <div className="stat-label">Остава за събиране</div>
                <div className="stat-value">{obligationTotals.remaining.toFixed(2)} €</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isViewer && (
        <div className="dashboard-section dashboard-liquid">
          <h2 className="dashboard-section-title">Налични пари</h2>
          <p className="dashboard-section-lead">
            Салдо по каса, банкова сметка и фонд ремонт (по приходи, плащания в «Задължения» и разходи — вж. «Финанси →
            Налични пари»).
          </p>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.08)' }}>
                <Wallet size={24} color="var(--primary)" />
              </div>
              <div className="stat-content">
                <div className="stat-label stat-label--mock">
                  Налични средства в касата
                  <span className="stat-label--mock-sub">(в брой към днешна дата)</span>
                </div>
                <div className="stat-value">{liquidBalances.cash.toFixed(2)} €</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(14, 116, 144, 0.12)' }}>
                <Landmark size={24} color="var(--primary)" />
              </div>
              <div className="stat-content">
                <div className="stat-label stat-label--mock">
                  Налични средства по банкова сметка
                  <span className="stat-label--mock-sub">(актуален баланс)</span>
                </div>
                <div className="stat-value">{liquidBalances.bank.toFixed(2)} €</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.15)' }}>
                <Hammer size={24} color="var(--primary)" />
              </div>
              <div className="stat-content">
                <div className="stat-label stat-label--mock">
                  Средства във фонд Ремонт
                  <span className="stat-label--mock-sub">(по закон за ЕС)</span>
                </div>
                <div className="stat-value">{liquidBalances.repairFund.toFixed(2)} €</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isViewer && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
              <TrendingUp size={24} color="var(--success)" />
            </div>
            <div className="stat-content">
              <div className="stat-label">
                Постъпили плащания{statsYear === 'all' ? '' : ` (${statsYear})`}
              </div>
              <div className="stat-value">{stats.totalPayments.toFixed(2)} €</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
              <TrendingDown size={24} color="var(--danger)" />
            </div>
            <div className="stat-content">
              <div className="stat-label">Разходи{statsYear === 'all' ? '' : ` (${statsYear})`}</div>
              <div className="stat-value">{stats.totalExpenses.toFixed(2)} €</div>
            </div>
          </div>
        </div>
      )}

      {!isViewer && (
      <div className="balance-card">
        <h2>
          {statsYear === 'all'
            ? 'Оборот (по записи за избрания обхват)'
            : `Оборот за ${statsYear} (по записи)`}
        </h2>
        <div className={`balance-amount ${balance >= 0 ? 'positive' : 'negative'}`}>
          {balance >= 0 ? '+' : ''}
          {balance.toFixed(2)} €
        </div>
        <p className="balance-breakdown">
          {statsYear === 'all' ? (
            <>
              {stats.totalOtherIncome.toFixed(2)} € (други приходи от „Финанси“) +{' '}
              {stats.totalPayments.toFixed(2)} € (постъпили плащания от „Задължения“) −{' '}
              {stats.totalExpenses.toFixed(2)} € (разходи)
            </>
          ) : (
            <>
              {stats.totalOtherIncome.toFixed(2)} € (други приходи за {statsYear}) +{' '}
              {stats.totalPayments.toFixed(2)} € (постъпили плащания за {statsYear}) −{' '}
              {stats.totalExpenses.toFixed(2)} € (разходи за {statsYear})
            </>
          )}
        </p>
        <p className="balance-description">
          {balance >= 0
            ? 'Положителен резултат по другите приходи, плащанията от задължения и разходите за периода — отделно от редовете „Налични пари“ по-горе.'
            : 'Отрицателен резултат по записаните приходи и разходи за периода.'}
        </p>
      </div>
      )}

      {isViewer && (
        <>
          <div className="dashboard-viewer-twin" role="group" aria-label="Обобщение за сградата">
            <section className="dashboard-viewer-window" aria-labelledby="viewer-bento-a">
              <h2 id="viewer-bento-a" className="dashboard-viewer-window-title">
                Текущи Разходи/Приходи
              </h2>
              <div
                className="dashboard-viewer-bento"
                role="group"
                aria-label="Текущи задължения, събрано и остатък"
              >
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label">Текущи задължения</span>
                  <span className="dashboard-viewer-bento-value">
                    {obligationTotals.charged.toFixed(2)} €
                  </span>
                </div>
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label">Събрани</span>
                  <span className="dashboard-viewer-bento-value">
                    {obligationTotals.collected.toFixed(2)} €
                  </span>
                </div>
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label">Остават</span>
                  <span className="dashboard-viewer-bento-value">
                    {obligationTotals.remaining.toFixed(2)} €
                  </span>
                </div>
              </div>
            </section>
            <section className="dashboard-viewer-window" aria-labelledby="viewer-bento-b">
              <h2 id="viewer-bento-b" className="dashboard-viewer-window-title">
                Задължения/Налични пари
              </h2>
              <div
                className="dashboard-viewer-bento dashboard-viewer-bento--4"
                role="group"
                aria-label="Неплатена сума, каса, сметка, фонд ремонт"
              >
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label">Задължения</span>
                  <span className="dashboard-viewer-bento-value dashboard-viewer-bento-value--debt">
                    {obligationTotals.remaining.toFixed(2)} €
                  </span>
                </div>
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label dashboard-viewer-bento-label--mock">
                    Налични средства в касата
                    <span className="dashboard-viewer-bento-label-mock-sub">(в брой към днешна дата)</span>
                  </span>
                  <span className="dashboard-viewer-bento-value dashboard-viewer-bento-value--cash">
                    {liquidBalances.cash.toFixed(2)} €
                  </span>
                </div>
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label dashboard-viewer-bento-label--mock">
                    Налични средства по банкова сметка
                    <span className="dashboard-viewer-bento-label-mock-sub">(актуален баланс)</span>
                  </span>
                  <span className="dashboard-viewer-bento-value dashboard-viewer-bento-value--cash">
                    {liquidBalances.bank.toFixed(2)} €
                  </span>
                </div>
                <div className="dashboard-viewer-bento-cell">
                  <span className="dashboard-viewer-bento-label dashboard-viewer-bento-label--mock">
                    Средства във фонд Ремонт
                    <span className="dashboard-viewer-bento-label-mock-sub">(по закон за ЕС)</span>
                  </span>
                  <span className="dashboard-viewer-bento-value dashboard-viewer-bento-value--cash">
                    {liquidBalances.repairFund.toFixed(2)} €
                  </span>
                </div>
              </div>
            </section>
          </div>

          <div className="dashboard-viewer-panel">
            <h2>Вашите задължения</h2>
            {viewerSnapshotLoading ? (
              <p className="dashboard-viewer-muted">Зареждане…</p>
            ) : !viewerHasLinkedUnits ? (
              <p className="dashboard-viewer-muted" style={{ marginBottom: 0 }}>
                Нямате свързани обекти. Помолете домоуправителя да ви добави към вашия апартамент / обект.
              </p>
            ) : (
              <div className={`viewer-my-due ${viewerMyDue > 0 ? 'owes' : 'ok'}`} style={{ marginBottom: 0 }}>
                {viewerMyDue > 0 ? (
                  <>
                    Остатък: <strong>{viewerMyDue.toFixed(2)} €</strong> по всички свързани обекти.
                  </>
                ) : (
                  <>Няма остатък по задължения за вашите обекти.</>
                )}
              </div>
            )}
          </div>

          <div className="dashboard-viewer-panel">
            <h2>
              <CreditCard size={20} className="dashboard-inline-icon" aria-hidden />
              Вашите плащания
            </h2>
            {viewerSnapshotLoading ? (
              <p className="dashboard-viewer-muted">Зареждане…</p>
            ) : viewerMyPayments.length === 0 ? (
              <p className="dashboard-viewer-muted">Няма регистрирани плащания по вашите обекти.</p>
            ) : (
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Обект</th>
                      <th>Описание</th>
                      <th className="num">Сума (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewerMyPayments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.paymentDate
                            ? format(new Date(p.paymentDate), 'dd.MM.yyyy', { locale: bg })
                            : '—'}
                        </td>
                        <td>{p.unitLabel}</td>
                        <td className="dashboard-payment-desc">{p.description}</td>
                        <td className="num">{p.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="dashboard-viewer-panel">
            <h2>
              <History size={20} className="dashboard-inline-icon" aria-hidden />
              Задължения
            </h2>
            <p className="dashboard-viewer-muted" style={{ marginTop: 0 }}>
              Списък с всички задължения по сградата (с филтри и периоди) — в раздел «Задължения».
            </p>
            <Link to="/obligations" className="btn-secondary dashboard-viewer-movements-link">
              Към Задължения
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
