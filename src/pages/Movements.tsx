import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Download, History } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { paymentDescriptionWithMethod } from '../lib/paymentDescription'
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
}

const PAGE_SIZE = 25

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: pays, error: pe }, { data: exps, error: ee }, { data: incomes, error: incomeErr }] =
        await Promise.all([
          supabaseQuery(() =>
            supabase
              .from('payments')
              .select(
                `id, amount, payment_date, created_at, created_by, notes, status, payment_method,
               payment_allocations ( amount, unit_obligations ( title, kind ) ),
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
                'id, amount, date, description, type, created_at, received_to, units:unit_id ( number, group:group_id (name) )'
              )
              .order('date', { ascending: false })
              .limit(800)
          ),
        ])
      if (pe) throw pe
      if (ee) throw ee
      if (incomeErr) throw incomeErr

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
          | { amount: number | string; unit_obligations: { title: string; kind: string } | null }[]
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
        })
      }

      for (const raw of incomes || []) {
        const x = raw as {
          id: string
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
      return true
    })
  }, [rows, filterKind, filterDateFrom, filterDateTo])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRows, safePage]
  )

  useEffect(() => {
    setPage(1)
  }, [filterDateFrom, filterDateTo, filterKind])

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
