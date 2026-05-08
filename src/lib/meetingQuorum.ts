/** Фази и праг на кворум за общо събрание (ид. части в %). */

export type MeetingPhase = 'first' | 'second'

const FIRST_PHASE_MS = 60 * 60 * 1000

/** Първи час след convening_started_at → първо свикване; след това — второ. */
export function getMeetingPhase(conveningStartedAt: Date, serverNow: Date): MeetingPhase {
  return serverNow.getTime() - conveningStartedAt.getTime() < FIRST_PHASE_MS ? 'first' : 'second'
}

/**
 * Повишен кворум (75% и двата етапа), ако някой потребител държи сумарно > 51% ид. части
 * по всички свързани му обекти (user_unit_links × units.building_ideal_share_percent).
 */
export function computeElevatedQuorumRequired(
  shareByUnitId: Map<string, number | null | undefined>,
  links: ReadonlyArray<{ user_id: string; unit_id: string }>
): boolean {
  const sumByUser = new Map<string, number>()
  for (const { user_id, unit_id } of links) {
    const raw = shareByUnitId.get(unit_id)
    const v = raw == null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    sumByUser.set(user_id, (sumByUser.get(user_id) ?? 0) + v)
  }
  for (const total of sumByUser.values()) {
    if (total > 51) return true
  }
  return false
}

export function quorumThresholdPercent(phase: MeetingPhase, elevated: boolean): number {
  if (elevated) return 75
  return phase === 'first' ? 51 : 33
}

/** Сума ид. части за избраните обекти (един обект веднъж). */
export function sumIdealShareForUnits(
  unitIds: Iterable<string>,
  shareByUnitId: Map<string, number | null | undefined>
): number {
  let s = 0
  for (const id of unitIds) {
    const raw = shareByUnitId.get(id)
    if (raw != null && !Number.isNaN(Number(raw))) s += Number(raw)
  }
  return Math.round(s * 1000000) / 1000000
}

export type QuorumEvaluation = {
  phase: MeetingPhase
  elevated: boolean
  thresholdPercent: number
  representedPercent: number
  quorumMet: boolean
}

export function evaluateQuorum(
  conveningStartedAt: Date,
  serverNow: Date,
  attendeeUnitIds: ReadonlySet<string>,
  shareByUnitId: Map<string, number | null | undefined>,
  userUnitLinks: ReadonlyArray<{ user_id: string; unit_id: string }>
): QuorumEvaluation {
  const phase = getMeetingPhase(conveningStartedAt, serverNow)
  const elevated = computeElevatedQuorumRequired(shareByUnitId, userUnitLinks)
  const thresholdPercent = quorumThresholdPercent(phase, elevated)
  const representedPercent = sumIdealShareForUnits(attendeeUnitIds, shareByUnitId)
  const quorumMet = representedPercent >= thresholdPercent
  return {
    phase,
    elevated,
    thresholdPercent,
    representedPercent,
    quorumMet,
  }
}
