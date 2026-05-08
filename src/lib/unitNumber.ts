/**
 * Номера на обекти: консистентно сортиране (1 &lt; 2 &lt; 10) и показване с водеща нула (01) в менюта.
 */

export function compareUnitNumberStrings(a: string, b: string): number {
  const ta = String(a ?? '').trim()
  const tb = String(b ?? '').trim()
  const na = parseFloat(ta.replace(',', '.'))
  const nb = parseFloat(tb.replace(',', '.'))
  if (
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    /^\d+[.,]?\d*$/.test(ta) &&
    /^\d+[.,]?\d*$/.test(tb)
  ) {
    if (na !== nb) return na - nb
  }
  return ta.localeCompare(tb, 'bg', { numeric: true })
}

/**
 * Номер за показване в менюта и справки: едноцифрени цели числа → 01, 02 …
 * за визуална последователност с 10, 11 (сортирането е в compareUnitNumberStrings).
 */
export function formatUnitNumberDisplay(raw: string | number | null | undefined): string {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (/^\d$/.test(s)) return `0${s}`
  return s
}

/** Стабилен ред в падащи менюта и таблици: тип група, после номер като число. */
export function sortUnitsByTypeAndNumber<T extends { number: string | number | null; type?: string }>(
  units: T[]
): T[] {
  return [...units].sort((a, b) => {
    const tc = String(a.type ?? '').localeCompare(String(b.type ?? ''), 'bg')
    if (tc !== 0) return tc
    return compareUnitNumberStrings(String(a.number ?? ''), String(b.number ?? ''))
  })
}

const RESIDENTIAL_GROUP_CODES = new Set(['apartment', 'atelier'])

function isResidentialGroupCode(code: string | null | undefined): boolean {
  return RESIDENTIAL_GROUP_CODES.has(String(code ?? '').toLowerCase())
}

/**
 * Ред „по апартамент“: първо по номер на обект; при един и същ номер — апартамент/ателие пред гараж и др.
 */
export function sortUnitsApartmentFirst<
  T extends {
    number: string | number | null
    group?: { code?: string | null } | null
    type?: string
  },
>(units: T[]): T[] {
  return [...units].sort((a, b) => {
    const ncmp = compareUnitNumberStrings(String(a.number ?? ''), String(b.number ?? ''))
    if (ncmp !== 0) return ncmp
    const rank = (u: T) => (isResidentialGroupCode(u.group?.code) ? 0 : 1)
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return String(a.type ?? '').localeCompare(String(b.type ?? ''), 'bg')
  })
}

/** Най-малкият „основен“ номер за подреждане на собственици: апартамент/ателие, иначе минимален номер измежду всички техни обекти. */
export function primaryApartmentSortKey<
  T extends { number: string | number | null; group?: { code?: string | null } | null },
>(units: T[]): string {
  const residential = units.filter((u) => isResidentialGroupCode(u.group?.code))
  const pool = residential.length > 0 ? residential : units
  let best = ''
  for (const u of pool) {
    const n = String(u.number ?? '').trim()
    if (!best || compareUnitNumberStrings(n, best) < 0) best = n
  }
  return best
}
