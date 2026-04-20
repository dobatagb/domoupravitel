import { useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { sortUnitsByTypeAndNumber, formatUnitNumberDisplay } from '../lib/unitNumber'
import { Download, LayoutGrid } from 'lucide-react'
import './ObligationsBoard.css'

interface UnitRow {
  id: string
  number: string
  type: string
  floor: string | null
  group?: { name: string } | null
}

interface ObligationRow {
  unit_id: string
  amount_remaining: string | number
  kind: string
  title: string
}

const EXTRA_COL = '__extraordinary__'
/** Всички редовни редове в една колона (сбит режим). */
const REGULAR_SUM_COL = '__regular_all__'

function obligationColKey(ob: ObligationRow): string {
  if (ob.kind === 'extraordinary') return EXTRA_COL
  return `t:${ob.title}`
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
    const label = `${gname} ${formatUnitNumberDisplay(u.number)}`.trim()
    const totalDue = unitTotals[u.id] ?? 0
    parts.push(`<tr><td>${escapeHtml(label)}</td><td class="c">${totalDue.toFixed(2)}</td></tr>`)
  }
  parts.push('</table></body></html>')
  return parts.join('')
}

function columnHeading(key: string): string {
  if (key === EXTRA_COL) return 'Извънредни'
  if (key === REGULAR_SUM_COL) return 'Редовни (всички)'
  return key.startsWith('t:') ? key.slice(2) : key
}

function columnHasAnyOwed(
  matrix: Record<string, Record<string, number>>,
  unitIds: string[],
  key: string,
): boolean {
  const eps = 0.005
  for (const id of unitIds) {
    if ((matrix[id]?.[key] ?? 0) > eps) return true
  }
  return false
}

export default function ObligationsBoard() {
  const { labelForCode } = useUnitGroups()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [units, setUnits] = useState<UnitRow[]>([])
  const [obligations, setObligations] = useState<ObligationRow[]>([])
  /** false = колона за всяко заглавие на редовно задължение; true = една колона за всички редовни. */
  const [compactRegulars, setCompactRegulars] = useState(true)

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
            .select('id, number, type, floor, group:group_id (name)')
            .order('type', { ascending: true })
            .order('number', { ascending: true })
        ),
        supabaseQuery(() =>
          supabase.from('unit_obligations').select('unit_id, amount_remaining, kind, title').gt('amount_remaining', 0)
        ),
      ])
      if (eu) throw eu
      if (eo) throw eo
      const unitRows = (u ?? []) as unknown[]
      const mapped = unitRows.map((row) => {
        const r = row as UnitRow & { group?: { name: string } | { name: string }[] | null }
        const g = r.group
        const group = Array.isArray(g) ? g[0] ?? null : g ?? null
        return { ...r, group }
      })
      setUnits(sortUnitsByTypeAndNumber(mapped))
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
    let hasExtra = false
    let hasRegular = false
    const regularTitles = new Set<string>()
    for (const ob of obligations) {
      const v = parseAmt(ob.amount_remaining)
      if (v <= 0) continue
      if (ob.kind === 'extraordinary') hasExtra = true
      else {
        hasRegular = true
        regularTitles.add(ob.title)
      }
    }

    let colKeys: string[] = []
    if (compactRegulars) {
      if (hasExtra) colKeys.push(EXTRA_COL)
      if (hasRegular) colKeys.push(REGULAR_SUM_COL)
    } else {
      if (hasExtra) colKeys.push(EXTRA_COL)
      const titlesSorted = [...regularTitles].sort((a, b) => a.localeCompare(b, 'bg', { sensitivity: 'base' }))
      for (const t of titlesSorted) {
        colKeys.push(`t:${t}`)
      }
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
      let key: string
      if (compactRegulars) {
        key = ob.kind === 'extraordinary' ? EXTRA_COL : REGULAR_SUM_COL
      } else {
        key = obligationColKey(ob)
      }
      if (!matrix[ob.unit_id]) matrix[ob.unit_id] = {}
      matrix[ob.unit_id][key] = (matrix[ob.unit_id][key] ?? 0) + v
      unitTotals[ob.unit_id] = (unitTotals[ob.unit_id] ?? 0) + v
    }

    const unitIds = units.map((u) => u.id)
    colKeys = colKeys.filter((key) => columnHasAnyOwed(matrix, unitIds, key))

    const columns = colKeys.map((key) => ({
      key,
      kind: key === EXTRA_COL ? ('extraordinary' as const) : ('regular' as const),
      title: columnHeading(key),
    }))

    return { columns, matrix, unitTotals }
  }, [units, obligations, compactRegulars])

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
        <strong>Сбит изглед</strong> — колони „Извънредни“ и „Редовни (всички)“. <strong>Без отметка</strong> — отделна колона
        за всяко заглавие (както в „Периоди“). Колона се показва само ако <strong>поне един обект</strong> има остатък по нея;
        ако по тази колона всички са платили, тя не се показва. Данните са с ненулев остатък. При плащане приспадането е: първо
        извънредни, после редовни. <strong>Обект</strong> и <strong>Общо дължимо</strong> остават закачени при скрол.{' '}
        <strong>Export</strong> — <strong>Обект</strong> и <strong>Дължи Общо</strong>.
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
          {obligations.length > 0 ? (
            <label className="obligations-board-compact-toggle">
              <input
                type="checkbox"
                checked={compactRegulars}
                onChange={(e) => setCompactRegulars(e.target.checked)}
              />
              Сбит изглед (редовните в една колона)
            </label>
          ) : null}
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
                    title={c.kind === 'extraordinary' ? 'Извънредни задължения' : c.title}
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
                const label = `${gname} ${formatUnitNumberDisplay(u.number)}`.trim()
                const floorLine = u.floor?.trim()
                const total = unitTotals[u.id] ?? 0
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="obligations-board-unit-title">{label}</div>
                      {floorLine && <div className="obligations-board-owner">Етаж: {floorLine}</div>}
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
