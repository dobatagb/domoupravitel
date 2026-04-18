import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { LayoutGrid } from 'lucide-react'
import './ObligationsBoard.css'

interface UnitRow {
  id: string
  number: string
  type: string
  owner_name: string
  floor: string | null
  group?: { name: string } | null
}

interface ObligationRow {
  unit_id: string
  amount_remaining: string | number
  kind: string
  title: string
  sort_key: number
  billing_period_id: string | null
}

function colKey(o: Pick<ObligationRow, 'kind' | 'title' | 'billing_period_id'>): string {
  return `${o.kind}\t${o.billing_period_id ?? 'null'}\t${o.title}`
}

function parseAmt(v: string | number): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

export default function ObligationsBoard() {
  const { labelForCode } = useUnitGroups()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [units, setUnits] = useState<UnitRow[]>([])
  const [obligations, setObligations] = useState<ObligationRow[]>([])

  useEffect(() => {
    void load()
  }, [])

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [{ data: u, error: eu }, { data: o, error: eo }] = await Promise.all([
        supabaseQuery(() =>
          supabase
            .from('units')
            .select('id, number, type, owner_name, floor, group:group_id (name)')
            .order('type', { ascending: true })
            .order('number', { ascending: true })
        ),
        supabaseQuery(() =>
          supabase
            .from('unit_obligations')
            .select('unit_id, amount_remaining, kind, title, sort_key, billing_period_id')
            .gt('amount_remaining', 0)
        ),
      ])
      if (eu) throw eu
      if (eo) throw eo
      const unitRows = (u ?? []) as unknown[]
      setUnits(
        unitRows.map((row) => {
          const r = row as UnitRow & { group?: { name: string } | { name: string }[] | null }
          const g = r.group
          const group = Array.isArray(g) ? g[0] ?? null : g ?? null
          return { ...r, group }
        })
      )
      setObligations((o as ObligationRow[]) || [])
    } catch (e: unknown) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Грешка при зареждане'
      setLoadError(
        msg.includes('floor') || msg.includes('column')
          ? `${msg}\n\nАко липсва колона floor, изпълни database_migrations/024_units_floor.sql в Supabase.`
          : msg
      )
      setUnits([])
      setObligations([])
    } finally {
      setLoading(false)
    }
  }

  const { columns, matrix, unitTotals } = useMemo(() => {
    const meta = new Map<string, { kind: string; title: string; sort_key: number }>()
    for (const ob of obligations) {
      const k = colKey(ob)
      if (!meta.has(k)) {
        meta.set(k, { kind: ob.kind, title: ob.title, sort_key: ob.sort_key })
      }
    }
    const keys = [...meta.keys()].sort((ka, kb) => {
      const a = meta.get(ka)!
      const b = meta.get(kb)!
      if (a.kind !== b.kind) {
        if (a.kind === 'regular' && b.kind === 'extraordinary') return -1
        if (a.kind === 'extraordinary' && b.kind === 'regular') return 1
      }
      if (a.sort_key !== b.sort_key) return a.sort_key - b.sort_key
      return ka.localeCompare(kb)
    })

    const matrix: Record<string, Record<string, number>> = {}
    const unitTotals: Record<string, number> = {}

    for (const un of units) {
      matrix[un.id] = {}
      unitTotals[un.id] = 0
    }

    for (const ob of obligations) {
      const k = colKey(ob)
      const v = parseAmt(ob.amount_remaining)
      if (v <= 0) continue
      if (!matrix[ob.unit_id]) matrix[ob.unit_id] = {}
      matrix[ob.unit_id][k] = (matrix[ob.unit_id][k] ?? 0) + v
      unitTotals[ob.unit_id] = (unitTotals[ob.unit_id] ?? 0) + v
    }

    const columns = keys.map((key) => ({
      key,
      ...meta.get(key)!,
    }))

    return { columns, matrix, unitTotals }
  }, [units, obligations])

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="obligations-board-page">
      <div className="page-header" style={{ marginBottom: '0.5rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LayoutGrid size={28} aria-hidden />
          Табло по задължения
        </h1>
      </div>
      <p className="obligations-board-sub">
        Колоните са само задължения с остатък &gt; 0 поне при един обект. Редът е: първо <strong>редовни</strong> (по
        време), после <strong>извънредни</strong>. Последната колона е общата дължима сума по обект. При плащане
        приспадането в системата е: първо извънредни, после редовни (най-старите първи) — виж спецификация §4.2.
      </p>

      {loadError && (
        <div className="load-error-banner" role="alert" style={{ marginBottom: '1rem' }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{loadError}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Опитай отново
          </button>
        </div>
      )}

      <div className="obligations-board-legend">
        <span>
          Редовни колони: стандартен фон. <span className="extra">Извънредни: оцветени.</span>
        </span>
      </div>

      {units.length === 0 ? (
        <p className="obligations-board-empty">Няма регистрирани обекти.</p>
      ) : columns.length === 0 ? (
        <p className="obligations-board-empty">Няма непогасени задължения — няма какво да се покаже в матрицата.</p>
      ) : (
        <div className="obligations-board-wrap">
          <table className="obligations-board-table">
            <thead>
              <tr>
                <th scope="col">Обект</th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.kind === 'extraordinary' ? 'col-extra' : ''}
                    title={c.kind === 'extraordinary' ? 'Извънредно задължение' : 'Редовно задължение'}
                  >
                    {c.title}
                    {c.kind === 'extraordinary' ? ' (извънр.)' : ''}
                  </th>
                ))}
                <th scope="col" className="col-total">
                  Общо дължимо
                </th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const gname = u.group?.name ?? labelForCode(u.type)
                const label = `${gname} ${u.number}`.trim()
                const floorLine = u.floor?.trim()
                const total = unitTotals[u.id] ?? 0
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="obligations-board-unit-title">{label}</div>
                      {floorLine && <div className="obligations-board-owner">Етаж: {floorLine}</div>}
                      <div className="obligations-board-owner">{u.owner_name}</div>
                    </td>
                    {columns.map((c) => {
                      const v = matrix[u.id]?.[c.key] ?? 0
                      const show = v > 0.005
                      return (
                        <td
                          key={c.key}
                          className={
                            !show ? 'cell-empty' : c.kind === 'extraordinary' ? 'cell-extra' : undefined
                          }
                        >
                          {show ? `${v.toFixed(2)} €` : '–'}
                        </td>
                      )
                    })}
                    <td className="col-total">
                      <span className={total > 0.005 ? 'balance-owed' : 'balance-ok'}>{total.toFixed(2)} €</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
