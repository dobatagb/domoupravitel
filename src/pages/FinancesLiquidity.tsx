import { useCallback, useEffect, useState } from 'react'
import { Landmark, Wallet } from 'lucide-react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { fetchLedgerDetail, type LedgerDetail } from '../lib/liquidityLedger'
import './FinancesLiquidity.css'

export default function FinancesLiquidity() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ledger, setLedger] = useState<LedgerDetail | null>(null)
  const [paidOblByMethod, setPaidOblByMethod] = useState({ cash: 0, bank: 0, other: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: payRows, error: payErr }, d] = await Promise.all([
        supabaseQuery(() => supabase.from('payments').select('amount, payment_method').eq('status', 'paid')),
        fetchLedgerDetail(),
      ])
      if (payErr) {
        console.warn('FinancesLiquidity: payments for breakdown', payErr)
        setPaidOblByMethod({ cash: 0, bank: 0, other: 0 })
      } else {
        let cashP = 0
        let bankP = 0
        let otherP = 0
        for (const raw of payRows || []) {
          const p = raw as { amount: number | string; payment_method: string | null }
          const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : Number(p.amount)
          if (!Number.isFinite(amt)) continue
          const m = (p.payment_method ?? '').trim().toLowerCase()
          if (m === 'cash') cashP += amt
          else if (m === 'bank_transfer') bankP += amt
          else otherP += amt
        }
        setPaidOblByMethod({
          cash: Math.round(cashP * 100) / 100,
          bank: Math.round(bankP * 100) / 100,
          other: Math.round(otherP * 100) / 100,
        })
      }
      setLedger(d)
    } catch (e: unknown) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Грешка при зареждане')
      setLedger(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const total = (ledger?.cash ?? 0) + (ledger?.bank ?? 0)
  const p = ledger?.parts

  if (loading) {
    return <p className="fin-liq-muted">Зареждане на наличности…</p>
  }

  return (
    <div className="fin-liq">
      <p className="fin-liq-lead">
        <strong>Каса (в брой)</strong> и <strong>сметка</strong> се <strong>изчисляват</strong> от дневника: приходи
        (таблица «Други приходи» — къде влиза: каса или сметка), <strong>+</strong> плащания от «Задължения» с начин
        <strong> в брой</strong> / <strong>банков превод</strong>, <strong>−</strong> разходи (от каса / от сметка).
        Плащания с <strong>карта/друго/без начин</strong> намаляват дълга, но <strong>не</strong> влизат в тези баланси.
        Няма ръчна корекция в настройките — при нужда въведи <strong>приход</strong> (напр. корекция) в таба «Други
        приходи».
      </p>

      <div className="fin-liq-cards">
        <div className="fin-liq-card">
          <div className="fin-liq-card-icon" style={{ background: 'rgba(37, 99, 235, 0.08)' }}>
            <Wallet size={26} aria-hidden />
          </div>
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Каса (в брой)</div>
            <div className="fin-liq-value">{(ledger?.cash ?? 0).toFixed(2)} €</div>
          </div>
        </div>
        <div className="fin-liq-card">
          <div className="fin-liq-card-icon" style={{ background: 'rgba(14, 116, 144, 0.12)' }}>
            <Landmark size={26} aria-hidden />
          </div>
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Сметка</div>
            <div className="fin-liq-value">{(ledger?.bank ?? 0).toFixed(2)} €</div>
          </div>
        </div>
        <div className="fin-liq-card fin-liq-card-total">
          <div className="fin-liq-card-body">
            <div className="fin-liq-label">Общо налични</div>
            <div className="fin-liq-value fin-liq-total">{total.toFixed(2)} €</div>
          </div>
        </div>
      </div>

      {p && (
        <div className="fin-liq-reconcile" role="region" aria-label="Салдо по източници">
          <h3 className="fin-liq-reconcile-title">Салдо: приходи + плащания по задължения − разходи</h3>
          <p className="fin-liq-reconcile-line">
            <strong>Каса</strong> = приходи {p.incomeCash.toFixed(2)} € + плащания (в брой) {p.paymentCash.toFixed(2)} € −
            разходи (от каса) {p.expenseCash.toFixed(2)} € = <strong>{(ledger?.cash ?? 0).toFixed(2)} €</strong>
          </p>
          <p className="fin-liq-reconcile-line">
            <strong>Сметка</strong> = приходи {p.incomeBank.toFixed(2)} € + плащания (банк.) {p.paymentBank.toFixed(2)} € −
            разходи (от сметка) {p.expenseBank.toFixed(2)} € = <strong>{(ledger?.bank ?? 0).toFixed(2)} €</strong>
          </p>
        </div>
      )}

      <div className="fin-liq-reconcile" role="region" aria-label="Справка плащания">
        <h3 className="fin-liq-reconcile-title">Справка: плащания «Задължения» (статус „платено“)</h3>
        <p className="fin-liq-reconcile-line">
          <strong>В брой</strong>: {paidOblByMethod.cash.toFixed(2)} € — <strong>банков превод</strong>:{' '}
          {paidOblByMethod.bank.toFixed(2)} € — <strong>друго / карта / без начин</strong>:{' '}
          {paidOblByMethod.other.toFixed(2)} €
        </p>
      </div>

      {error && (
        <div className="fin-liq-error" role="alert">
          {error}
        </div>
      )}

      <p className="fin-liq-muted" style={{ marginTop: 0 }}>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Презареди
        </button>
      </p>
    </div>
  )
}
