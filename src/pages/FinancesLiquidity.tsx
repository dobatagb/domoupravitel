import { useCallback, useEffect, useState } from 'react'
import { Landmark, Wallet } from 'lucide-react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import './FinancesLiquidity.css'

function parseMoney(raw: string): number {
  const t = raw.trim().replace(',', '.')
  if (!t) return NaN
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : NaN
}

export default function FinancesLiquidity() {
  const { canEdit } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cash, setCash] = useState(0)
  const [bank, setBank] = useState(0)
  const [formCash, setFormCash] = useState('')
  const [formBank, setFormBank] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabaseQuery(() =>
        supabase.from('app_settings').select('cash_opening_balance, bank_account_balance').eq('id', 1).maybeSingle()
      )
      if (qErr) throw qErr
      const row = data as {
        cash_opening_balance?: number | string | null
        bank_account_balance?: number | string | null
      } | null
      const c = Number(row?.cash_opening_balance ?? 0)
      const b = Number(row?.bank_account_balance ?? 0)
      setCash(Number.isFinite(c) ? c : 0)
      setBank(Number.isFinite(b) ? b : 0)
      setFormCash(Number.isFinite(c) ? String(c) : '0')
      setFormBank(Number.isFinite(b) ? String(b) : '0')
    } catch (e: unknown) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Грешка при зареждане')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const total = cash + bank

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const c = parseMoney(formCash)
    const b = parseMoney(formBank)
    if (Number.isNaN(c) || Number.isNaN(b)) {
      setError('Въведи валидни числа за двете полета.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: uErr } = await supabase
        .from('app_settings')
        .update({
          cash_opening_balance: c,
          bank_account_balance: b,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
      if (uErr) throw uErr
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="fin-liq-muted">Зареждане на наличности…</p>
  }

  return (
    <div className="fin-liq">
      <p className="fin-liq-lead">
        Стойностите се увеличават автоматично при нови плащания от «Задължения» с начин &quot;В брой&quot; или
        &quot;Банков превод&quot; (след миграция 049 в Supabase). Оттук можеш да коригираш наличностите ръчно (начално
        въвеждане, сверка с банка).
      </p>

      <div className="fin-liq-cards">
        <div className="fin-liq-card">
          <div className="fin-liq-card-icon" style={{ background: 'rgba(37, 99, 235, 0.08)' }}>
            <Wallet size={26} aria-hidden />
          </div>
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Кеш</div>
            <div className="fin-liq-value">{cash.toFixed(2)} €</div>
          </div>
        </div>
        <div className="fin-liq-card">
          <div className="fin-liq-card-icon" style={{ background: 'rgba(14, 116, 144, 0.12)' }}>
            <Landmark size={26} aria-hidden />
          </div>
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Сметка</div>
            <div className="fin-liq-value">{bank.toFixed(2)} €</div>
          </div>
        </div>
        <div className="fin-liq-card fin-liq-card-total">
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Общо налични</div>
            <div className="fin-liq-value fin-liq-total">{total.toFixed(2)} €</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="fin-liq-error" role="alert">
          {error}
        </div>
      )}

      {canEdit() ? (
        <form className="fin-liq-form" onSubmit={handleSave}>
          <h3 className="fin-liq-form-title">Корекция на наличности</h3>
          <div className="fin-liq-form-row">
            <div className="fin-liq-field">
              <label htmlFor="fin-liq-cash">Кеш (€)</label>
              <input
                id="fin-liq-cash"
                type="text"
                inputMode="decimal"
                value={formCash}
                onChange={(e) => setFormCash(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="fin-liq-field">
              <label htmlFor="fin-liq-bank">Сметка (€)</label>
              <input
                id="fin-liq-bank"
                type="text"
                inputMode="decimal"
                value={formBank}
                onChange={(e) => setFormBank(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="fin-liq-form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Запис…' : 'Запази'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void load()} disabled={saving}>
              Презареди
            </button>
          </div>
        </form>
      ) : (
        <p className="fin-liq-muted">Корекцията е само за домоуправител (редактор / администратор).</p>
      )}
    </div>
  )
}
