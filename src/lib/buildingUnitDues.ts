import { supabase, supabaseQuery } from './supabase'

/** Суми неплатено по unit_id — от RPC (агрегат; важи за viewer без пълен SELECT по редове). */
export async function loadDueByUnitMap(): Promise<Record<string, number>> {
  const { data, error } = await supabaseQuery(() => supabase.rpc('building_unit_dues'))
  if (!error && data != null) {
    const map: Record<string, number> = {}
    for (const row of data as { unit_id: string; total_remaining: number | string }[]) {
      const v =
        typeof row.total_remaining === 'string'
          ? parseFloat(row.total_remaining)
          : Number(row.total_remaining)
      map[row.unit_id] = Number.isFinite(v) ? v : 0
    }
    return map
  }

  const { data: rows, error: selErr } = await supabaseQuery(() =>
    supabase.from('unit_obligations').select('unit_id, amount_remaining')
  )
  if (selErr) throw selErr
  const map: Record<string, number> = {}
  for (const row of rows || []) {
    const r = row as { unit_id: string; amount_remaining: number | string }
    const v =
      typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
    if (!Number.isFinite(v)) continue
    map[r.unit_id] = (map[r.unit_id] ?? 0) + v
  }
  return map
}
