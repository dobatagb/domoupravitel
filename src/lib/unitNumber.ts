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
