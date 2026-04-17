import type { UnitGroup } from '../types/unitGroup'

type GroupLike = Pick<UnitGroup, 'name' | 'list_label_short' | 'code'> | null | undefined

/** Име на група по код — използва заредени групи от базата. */
export function groupNameFromCode(code: string | null | undefined, groups: UnitGroup[]): string {
  if (!code) return ''
  return groups.find((g) => g.code === code)?.name ?? code
}

/** Компактен етикет за таблици: list_label_short или съкратено име. */
export function compactGroupLabel(g: GroupLike, codeFallback: string): string {
  if (g?.list_label_short?.trim()) return g.list_label_short.trim()
  if (g?.name) return g.name.length > 8 ? `${g.name.slice(0, 7)}…` : g.name
  return codeFallback.slice(0, 4)
}
