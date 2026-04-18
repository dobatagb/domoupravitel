import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { History } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Movements.css'

type MovementKind = 'in' | 'out'

interface MovementRow {
  id: string
  kind: MovementKind
  date: string | null
  label: string
  amount: number
  detail: string
  recorderEmail: string | null
  sortTs: number
}

export default function Movements() {
  const { canEdit } = useAuth()
  const [rows, setRows] = useState<MovementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: pays, error: pe }, { data: exps, error: ee }] = await Promise.all([
        supabaseQuery(() =>
          supabase
            .from('payments')
            .select(
              'id, amount, payment_date, created_at, created_by, notes, status, units ( number, group:group_id (name) )'
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
      ])
      if (pe) throw pe
      if (ee) throw ee

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
        out.push({
          id: `p-${pid}`,
          kind: 'in',
          date: dateStr,
          label: 'Постъпило плащане',
          amount: amt,
          detail: [unitLabel, status === 'paid' ? 'платено' : status, notes].filter(Boolean).join(' · '),
          recorderEmail: createdBy ? emailById[createdBy] ?? null : null,
          sortTs: t,
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
          detail: `${x.category}: ${x.description}`,
          recorderEmail: x.created_by ? emailById[x.created_by] ?? null : null,
          sortTs: t,
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
    if (!canEdit()) return
    void load()
  }, [canEdit, load])

  if (!canEdit()) {
    return (
      <div className="movements-page">
        <h1>Движения</h1>
        <p className="movements-muted">Тази справка е достъпна за домоуправителя (редактор / администратор).</p>
      </div>
    )
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
          Обединен преглед на постъпили плащания и разходи. За нови записи колоната „Записал“ се пълни автоматично след
          миграция 028.
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

      {rows.length === 0 && !error ? (
        <p className="movements-muted">Няма записи.</p>
      ) : (
        <div className="table-wrap movements-table-wrap">
          <table className="movements-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Вид</th>
                <th className="num">Сума (€)</th>
                <th>Описание</th>
                <th>Записал</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                  <td>{r.detail}</td>
                  <td className="movements-recorder">{r.recorderEmail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
