import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { Download, LayoutGrid } from 'lucide-react'
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
}

/** Фиксирани колони по вид задължение — без отделна колона за всеки период (иначе след години таблицата става неупотребима). */
const KIND_ORDER = ['regular', 'extraordinary'] as const

const KIND_LABEL: Record<string, string> = {
  regular: 'Редовни',
  extraordinary: 'Извънредни',
}

function parseAmt(v: string | number): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Един HTML табличен файл с разширение .xls — Excel го отваря с UTF-8 кирилица и широки колони.
 * CSV кодировките се държат различно по програми; този формат е стабилен за Excel.
 */
function buildExportXlsHtml(
  units: UnitRow[],
  unitTotals: Record<string, number>,
  labelForCode: (code: string) => string
): string {
  const parts: string[] = [
    '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    '<head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    '<style>table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif}td,th{border:1px solid #ccc;padding:8px 12px}th{background:#f1f5f9;font-weight:600}.c{text-align:right}</style>',
    '</head><body><table border="1" cellspacing="0" cellpadding="0">',
    '<colgroup><col style="width:360pt" /><col style="width:120pt" /></colgroup>',
    '<tr><th>Обект</th><th>Дължи Общо</th></tr>',
  ]
  for (const u of units) {
    const gname = u.group?.name ?? labelForCode(u.type)
    const label = `${gname} ${u.number}`.trim()
    const totalDue = unitTotals[u.id] ?? 0
    parts.push(`<tr><td>${escapeHtml(label)}</td><td class="c">${totalDue.toFixed(2)}</td></tr>`)
  }
  parts.push('</table></body></html>')
  return parts.join('')
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
          supabase.from('unit_obligations').select('unit_id, amount_remaining, kind').gt('amount_remaining', 0)
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
    const kindsWithBalance = new Set<string>()
    for (const ob of obligations) {
      if (parseAmt(ob.amount_remaining) > 0) kindsWithBalance.add(ob.kind)
    }
    const keys: string[] = []
    for (const k of KIND_ORDER) {
      if (kindsWithBalance.has(k)) keys.push(k)
    }
    for (const k of kindsWithBalance) {
      if (!keys.includes(k)) keys.push(k)
    }

    const matrix: Record<string, Record<string, number>> = {}
    const unitTotals: Record<string, number> = {}

    for (const un of units) {
      matrix[un.id] = {}
      unitTotals[un.id] = 0
    }

    for (const ob of obligations) {
      const v = parseAmt(ob.amount_remaining)
      if (v <= 0) continue
      const col = ob.kind
      if (!matrix[ob.unit_id]) matrix[ob.unit_id] = {}
      matrix[ob.unit_id][col] = (matrix[ob.unit_id][col] ?? 0) + v
      unitTotals[ob.unit_id] = (unitTotals[ob.unit_id] ?? 0) + v
    }

    const columns = keys.map((key) => ({
      key,
      kind: key,
      title: KIND_LABEL[key] ?? key,
    }))

    return { columns, matrix, unitTotals }
  }, [units, obligations])

  const handleExport = () => {
    if (units.length === 0) return
    const html = buildExportXlsHtml(units, unitTotals, labelForCode)
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tablo-zadalzheniya-${new Date().toISOString().slice(0, 10)}.xls`
    a.click()
    URL.revokeObjectURL(a.href)
  }

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
        Сумите по обект са <strong>агрегирани по вид</strong> (редовни / извънредни), без отделна колона за всеки
        период — така таблицата остава четима и след много години. Показват се само редове с остатък &gt; 0 поне при
        един обект. Последната колона е общо дължимо по обект. При плащане приспадането в системата е: първо
        извънредни, после редовни (най-старите първи). <strong>Export</strong> тегли таблица за Excel (.xls) с колони{' '}
        <strong>Обект</strong> и <strong>Дължи Общо</strong> (сумарно дължимо по обекта, като в колоната „Общо дължимо“).
      </p>

      {loadError && (
        <div className="load-error-banner" role="alert" style={{ marginBottom: '1rem' }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{loadError}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Опитай отново
          </button>
        </div>
      )}

      {units.length > 0 && (
        <div className="obligations-board-toolbar">
          <button type="button" className="btn-secondary obligations-board-export" onClick={handleExport}>
            <Download size={18} aria-hidden />
            Export
          </button>
        </div>
      )}

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
