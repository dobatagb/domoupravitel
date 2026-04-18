import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Link } from 'react-router-dom'
import { Building2, TrendingUp, TrendingDown, FileText, Wallet, CreditCard, LayoutGrid } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Dashboard.css'
import { loadDueByUnitMap } from '../lib/buildingUnitDues'
import YearScopeSelect, { type FinanceYearScope } from '../components/YearScopeSelect'

type ViewerBuildingRow = {
  unitId: string
  label: string
  owner: string
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
  const { canEdit, userRole, user } = useAuth()
  const isViewer = userRole === 'viewer'
  const [stats, setStats] = useState({
    totalUnits: 0,
    /** Сума от плащания (payments), статус „платено“ — постъпили в касата от Задължения */
    totalPayments: 0,
    totalExpenses: 0,
    totalDocuments: 0,
  })
  const [cashOpening, setCashOpening] = useState(0)
  const [cashDraft, setCashDraft] = useState('')
  const [cashSaving, setCashSaving] = useState(false)

  const [viewerBuildingRows, setViewerBuildingRows] = useState<ViewerBuildingRow[]>([])
  const [viewerMyDue, setViewerMyDue] = useState(0)
  const [viewerMyPayments, setViewerMyPayments] = useState<ViewerPaymentRow[]>([])
  const [viewerSnapshotLoading, setViewerSnapshotLoading] = useState(false)
  const [viewerHasLinkedUnits, setViewerHasLinkedUnits] = useState(false)
  const [statsYear, setStatsYear] = useState<FinanceYearScope>(() => new Date().getFullYear())

  useEffect(() => {
    void fetchStats(statsYear)
  }, [statsYear])

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
      const { count: unitsCount } = await supabase
        .from('units')
        .select('*', { count: 'exact', head: true })

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
      const totalExpenses = expensesData?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0

      let docsCount = 0
      if (scope === 'all') {
        const { count } = await supabase.from('documents').select('*', { count: 'exact', head: true })
        docsCount = count || 0
      } else {
        const { count } = await supabase
          .from('documents')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', `${scope}-01-01T00:00:00.000Z`)
          .lte('created_at', `${scope}-12-31T23:59:59.999Z`)
        docsCount = count || 0
      }

      let opening = 0
      try {
        const { data: settings, error } = await supabaseQuery(() =>
          supabase.from('app_settings').select('cash_opening_balance').eq('id', 1).maybeSingle()
        )
        if (!error && settings && settings.cash_opening_balance != null) {
          const n = Number(settings.cash_opening_balance)
          opening = Number.isFinite(n) ? n : 0
        }
      } catch {
        opening = 0
      }

      setCashOpening(opening)
      setCashDraft(String(opening))
      setStats({
        totalUnits: unitsCount || 0,
        totalPayments,
        totalExpenses,
        totalDocuments: docsCount || 0,
      })
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
          .select('id, owner_name, number, group:group_id (name)')
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
      const rows: ViewerBuildingRow[] = (units || []).map((u) => {
        const ug = u.group as { name?: string } | null
        const label = [ug?.name, u.number].filter(Boolean).join(' ')
        labelById[u.id] = label
        return {
          unitId: u.id,
          label,
          owner: u.owner_name,
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

      const myPayList: ViewerPaymentRow[] = (pays || [])
        .filter((p) => linkedIds.has((p as { unit_id: string }).unit_id))
        .map((p) => {
          const row = p as { id: string; unit_id: string; amount: number | string; payment_date: string | null }
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

  const saveCashOpening = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const n = parseFloat(cashDraft.replace(',', '.'))
    if (Number.isNaN(n) || n < 0) {
      alert('Въведи валидна сума (≥ 0).')
      return
    }
    setCashSaving(true)
    try {
      const { error } = await supabaseQuery(() =>
        supabase.from('app_settings').upsert(
          { id: 1, cash_opening_balance: n, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
      )
      if (error) throw error
      setCashOpening(n)
      setCashDraft(String(n))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис'
      alert(
        msg.includes('app_settings') || msg.includes('relation')
          ? `${msg}\n\nИзпълни миграцията database_migrations/017_app_settings_cash_opening.sql в Supabase.`
          : msg
      )
    } finally {
      setCashSaving(false)
    }
  }

  const balance =
    statsYear === 'all'
      ? cashOpening + stats.totalPayments - stats.totalExpenses
      : stats.totalPayments - stats.totalExpenses

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
            : `Филтър по календарна година за плащания (дата на плащане), разходи и дата на документ.`}
        </span>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)' }}>
            <Building2 size={24} color="var(--primary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Обекти</div>
            <div className="stat-value">{stats.totalUnits}</div>
          </div>
        </div>

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

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
            <FileText size={24} color="var(--secondary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Документи{statsYear === 'all' ? '' : ` (${statsYear})`}</div>
            <div className="stat-value">{stats.totalDocuments}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-cash-panel">
        <div className="dashboard-cash-head">
          <Wallet size={22} className="dashboard-cash-icon" aria-hidden />
          <h2>Начална наличност в касата</h2>
        </div>
        <p className="dashboard-cash-hint">
          Сума в касата преди записите в приложението (без превалутиране). Балансът по-долу = тази сума +
          постъпили плащания от страницата „Задължения“ (статус платено) − разходи от „Разходи“.
          {statsYear !== 'all' && (
            <>
              {' '}
              При избор на конкретна година по-долу балансът е <strong>нето за годината</strong> (без начална
              наличност).
            </>
          )}
        </p>
        {canEdit() ? (
          <form className="dashboard-cash-form" onSubmit={saveCashOpening}>
            <label htmlFor="cash-opening">Сума (€)</label>
            <div className="dashboard-cash-row">
              <input
                id="cash-opening"
                type="text"
                inputMode="decimal"
                value={cashDraft}
                onChange={(e) => setCashDraft(e.target.value)}
                placeholder="0"
              />
              <button type="submit" className="btn-primary" disabled={cashSaving}>
                {cashSaving ? 'Запис…' : 'Запази'}
              </button>
            </div>
          </form>
        ) : (
          <p className="dashboard-cash-readonly">
            <strong>{cashOpening.toFixed(2)} €</strong>
          </p>
        )}
      </div>

      <div className="balance-card">
        <h2>{statsYear === 'all' ? 'Обща наличност (очаквана каса)' : `Нето за ${statsYear} (плащания − разходи)`}</h2>
        <div className={`balance-amount ${balance >= 0 ? 'positive' : 'negative'}`}>
          {balance >= 0 ? '+' : ''}
          {balance.toFixed(2)} €
        </div>
        <p className="balance-breakdown">
          {statsYear === 'all' ? (
            <>
              {cashOpening.toFixed(2)} € (начало) + {stats.totalPayments.toFixed(2)} € (постъпили плащания) −{' '}
              {stats.totalExpenses.toFixed(2)} € (разходи)
            </>
          ) : (
            <>
              {stats.totalPayments.toFixed(2)} € (постъпили плащания за {statsYear}) −{' '}
              {stats.totalExpenses.toFixed(2)} € (разходи за {statsYear})
            </>
          )}
        </p>
        <p className="balance-description">
          {balance >= 0
            ? 'Положителен баланс спрямо записаните движения.'
            : 'Отрицателен баланс — преразход спрямо началото и записите.'}
        </p>
      </div>

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
              Собствениците виждат обобщена информация: текущо дължимо по задължения и постъпили плащания по
              обект.
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
                      <th>Собственик</th>
                      <th className="num">Дължи (€)</th>
                      <th className="num">Платено (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewerBuildingRows.map((r) => (
                      <tr key={r.unitId}>
                        <td>{r.label}</td>
                        <td>{r.owner}</td>
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
