import { useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Building2, TrendingUp, TrendingDown, FileText, Wallet } from 'lucide-react'
import './Dashboard.css'

export default function Dashboard() {
  const { canEdit } = useAuth()
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

  useEffect(() => {
    void fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const { count: unitsCount } = await supabase
        .from('units')
        .select('*', { count: 'exact', head: true })

      const { data: paymentsData } = await supabase.from('payments').select('amount').eq('status', 'paid')
      const totalPayments =
        paymentsData?.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) || 0

      const { data: expensesData } = await supabase.from('expenses').select('amount')
      const totalExpenses = expensesData?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0

      const { count: docsCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })

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

  const balance = cashOpening + stats.totalPayments - stats.totalExpenses

  return (
    <div className="dashboard">
      <h1>Начало</h1>
      <p className="dashboard-subtitle">Общ преглед на системата</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)' }}>
            <Building2 size={24} color="var(--primary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Единици</div>
            <div className="stat-value">{stats.totalUnits}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
            <TrendingUp size={24} color="var(--success)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Постъпили плащания</div>
            <div className="stat-value">{stats.totalPayments.toFixed(2)} €</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <TrendingDown size={24} color="var(--danger)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Разходи</div>
            <div className="stat-value">{stats.totalExpenses.toFixed(2)} €</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
            <FileText size={24} color="var(--secondary)" />
          </div>
          <div className="stat-content">
            <div className="stat-label">Документи</div>
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
        <h2>Обща наличност (очаквана каса)</h2>
        <div className={`balance-amount ${balance >= 0 ? 'positive' : 'negative'}`}>
          {balance >= 0 ? '+' : ''}
          {balance.toFixed(2)} €
        </div>
        <p className="balance-breakdown">
          {cashOpening.toFixed(2)} € (начало) + {stats.totalPayments.toFixed(2)} € (постъпили плащания) −{' '}
          {stats.totalExpenses.toFixed(2)} € (разходи)
        </p>
        <p className="balance-description">
          {balance >= 0
            ? 'Положителен баланс спрямо записаните движения.'
            : 'Отрицателен баланс — преразход спрямо началото и записите.'}
        </p>
      </div>
    </div>
  )
}
