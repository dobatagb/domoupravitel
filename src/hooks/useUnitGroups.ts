import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import type { UnitGroup } from '../types/unitGroup'

export function useUnitGroups() {
  const [groups, setGroups] = useState<UnitGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabaseQuery(() =>
        supabase.from('unit_groups').select('*').order('name', { ascending: true })
      )
      if (qErr) throw qErr
      setGroups((data as UnitGroup[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const byCode = useMemo(() => {
    const m = new Map<string, UnitGroup>()
    for (const g of groups) m.set(g.code, g)
    return m
  }, [groups])

  const labelForCode = useCallback(
    (code: string | null | undefined) => {
      if (!code) return ''
      return byCode.get(code)?.name ?? code
    },
    [byCode]
  )

  const shortLabelForCode = useCallback(
    (code: string | null | undefined) => {
      if (!code) return ''
      const g = byCode.get(code)
      if (g?.list_label_short?.trim()) return g.list_label_short.trim()
      if (g?.name) return g.name.length > 8 ? `${g.name.slice(0, 7)}…` : g.name
      return code
    },
    [byCode]
  )

  return { groups, loading, error, refresh, byCode, labelForCode, shortLabelForCode }
}
