import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, CreditCard, LayoutGrid, Wallet, Landmark } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Dashboard.css'
import { loadDueByUnitMap } from '../lib/buildingUnitDues'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'
import { compareUnitNumberStrings, formatUnitNumberDisplay } from '../lib/unitNumber'
import { useUnitGroups } from '../hooks/useUnitGroups'

type ViewerBuildingRow = {
  unitId: string
  label: string
  floor: string
  due: number
  paid: number
}

type ViewerPaymentRow = {
  id: string
  unitLabel: string
  amount: number
  paymentDate: string | null
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

  /** Текущо състояние по редове unit_obligations (без филтър по година). */
  const [obligationTotals, setObligationTotals] = useState({
    charged: 0,
    collected: 0,
    remaining: 0,
  })
  const [liquidBalances, setLiquidBalances] = useState({ cash: 0, bank: 0 })

  const [viewerBuildingRows, setViewerBuildingRows] = useState<ViewerBuildingRow[]>([])
  const [viewerMyDue, setViewerMyDue] = useState(0)
  const [viewerMyPayments, setViewerMyPayments] = useState<ViewerPaymentRow[]>([])
  const [viewerSnapshotLoading, setViewerSnapshotLoading] = useState(false)
  const [viewerHasLinkedUnits, setViewerHasLinkedUnits] = useState(false)
  const [statsYear, setStatsYear] = useState<FinanceYearScope>(() => new Date().getFullYear())

  useEffect(() => {
    void fetchStats(statsYear)
  }, [statsYear, isViewer])

  useEffect(() => {
    if (!isViewer || !user?.id) {
      setViewerBuildingRows([])
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
      if (isViewer) {
        setObligationTotals({ charged: 0, collected: 0, remaining: 0 })
        setLiquidBalances({ cash: 0, bank: 0 })
      }
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

      if (!isViewer) {
        const [{ data: oblRows, error: oblErr }, { data: settings, error: setErr }] = await Promise.all([
          supabase.from('unit_obligations').select('amount_original, amount_remaining'),
          supabase.from('app_settings').select('cash_opening_balance, bank_account_balance').eq('id', 1).maybeSingle(),
        ])
        if (!oblErr && oblRows) {
          let charged = 0
          let remaining = 0
          for (const raw of oblRows) {
            const r = raw as { amount_original: number | string; amount_remaining: number | string }
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

        if (!setErr && settings) {
          const s = settings as {
            cash_opening_balance?: number | string
            bank_account_balance?: number | string
          }
          const cash = Number(s.cash_opening_balance ?? 0)
          const bank = Number(s.bank_account_balance ?? 0)
          setLiquidBalances({
            cash: Number.isFinite(cash) ? cash : 0,
            bank: Number.isFinite(bank) ? bank : 0,
          })
        } else {
          setLiquidBalances({ cash: 0, bank: 0 })
        }
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

      const [{ data: units }, dueByUnit, { data: pays }] = await Promise.all([
        supabase
          .from('units')
          .select('id, number, floor, type, group:group_id (name)')
          .order('type', { ascending: true })
          .order('number', { ascending: true }),
        loadDueByUnitMap(),
        supabase.from('payments').select('id, unit_id, amount, payment_date, status').eq('status', 'paid'),
      ])

      const paidByUnit: Record<string, number> = {}
      for (const r of pays || []) {
        const row = r as { unit_id: string; amount: number | string }
        const v = typeof row.amount === 'string' ? parseFloat(row.amount) : Number(row.amount)
        if (!Number.isFinite(v)) continue
        paidByUnit[row.unit_id] = (paidByUnit[row.unit_id] ?? 0) + v
      }

      const labelById: Record<string, string> = {}
      type UnitRow = {
        id: string
        number: string | number
        floor?: string | null
        type: string
        group: { name?: string } | null
      }
      const unitList = ((units as UnitRow[] | null | undefined) ?? []).slice()
      unitList.sort((a, b) => compareUnitNumberStrings(String(a.number), String(b.number)))
      const rows: ViewerBuildingRow[] = unitList.map((u) => {
        const ug = u.group?.name ?? labelForCode(u.type)
        const n = formatUnitNumberDisplay(u.number)
        const label = [ug, n].filter(Boolean).join(' ')
        labelById[u.id] = label
        return {
          unitId: u.id,
          label,
          floor: (u.floor ?? '').trim(),
          due: dueByUnit[u.id] ?? 0,
          paid: paidByUnit[u.id] ?? 0,
        }
      })
      setViewerBuildingRows(rows)

      let myDue = 0
      for (const uid of linkedIds) {
        myDue += dueByUnit[uid] ?? 0
      }
      setViewerMyDue(myDue)

      type PayRow = {
        id: string
        unit_id: string
        amount: number | string
        payment_date: string | null
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
    <div className="dashboard">
      <h1>Начало</h1>
      <p className="dashboard-subtitle">
        {isViewer ? 'Обобщение за сградата и вашите задължения' : 'Общ преглед на системата'}
      </p>

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

      {!isViewer && (
        <div className="dashboard-section dashboard-obligation-snapshot">
          <h2 className="dashboard-section-title">Текущи задължения</h2>
          <p className="dashboard-section-lead">
            Обобщение по всички редове задължения: неплатената част е сумата, която още не е събрана от собствениците.
          </p>
          <div className="stats-grid dashboard-triple-stats">
            <div className="stat-card">
              <div className="stat-content">
                <div className="stat-label">Всичко начислено</div>
                <div className="stat-value">{obligationTotals.charged.toFixed(2)} €</div>
              </div>
            </div>
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
            Наличност в каса и по банкова сметка (задават се от администратор в настройките на системата).
          </p>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.08)' }}>
                <Wallet size={24} color="var(--primary)" />
              </div>
              <div className="stat-content">
                <div className="stat-label">Кеш</div>
                <div className="stat-value">{liquidBalances.cash.toFixed(2)} €</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(14, 116, 144, 0.12)' }}>
                <Landmark size={24} color="var(--primary)" />
              </div>
              <div className="stat-content">
                <div className="stat-label">Сметка</div>
                <div className="stat-value">{liquidBalances.bank.toFixed(2)} €</div>
              </div>
            </div>
          </div>
        </div>
      )}

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

      <div className="dashboard-board-link-wrap">
        <Link to="/obligations-board" className="dashboard-board-link">
          <LayoutGrid size={18} aria-hidden />
          Пълно табло по задължения (редовни / извънредни по обекти)
        </Link>
      </div>

      {isViewer && (
        <>
          <div className="dashboard-viewer-panel">
            <h2>Вашето задължение (свързани обекти)</h2>
            {viewerSnapshotLoading ? (
              <p className="dashboard-viewer-muted">Зареждане…</p>
            ) : !viewerHasLinkedUnits ? (
              <p className="dashboard-viewer-muted">
                Нямате свързани обекти към акаунта. Помолете домоуправителя да ви добави към вашия обект —
                тогава ще виждате личното си задължение и плащанията си.
              </p>
            ) : (
              <div className={`viewer-my-due ${viewerMyDue > 0 ? 'owes' : 'ok'}`}>
                {viewerMyDue > 0 ? (
                  <>
                    Дължите общо <strong>{viewerMyDue.toFixed(2)} €</strong> по всички ваши обекти (сумарно
                    оставащи задължения).
                  </>
                ) : (
                  <>По вашите свързани обекти няма остатък по задължения към момента.</>
                )}
              </div>
            )}
          </div>

          <div className="dashboard-viewer-panel">
            <h2>Справка по обекти (цялата сграда)</h2>
            <p className="dashboard-viewer-muted">
              Показват се номер, етаж и суми по задължения — без лични данни за собственици.
            </p>
            {viewerSnapshotLoading ? (
              <p className="dashboard-viewer-muted">Зареждане…</p>
            ) : viewerBuildingRows.length === 0 ? (
              <p className="dashboard-viewer-muted">Няма обекти.</p>
            ) : (
              <div className="dashboard-table-wrap">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Обект</th>
                      <th>Етаж</th>
                      <th className="num">Дължи (€)</th>
                      <th className="num">Платено (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewerBuildingRows.map((r) => (
                      <tr key={r.unitId}>
                        <td>{r.label}</td>
                        <td>{r.floor || '—'}</td>
                        <td className="num">{r.due.toFixed(2)}</td>
                        <td className="num">{r.paid.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                        <td className="num">{p.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
