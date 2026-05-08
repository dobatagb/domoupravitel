export type VoteChoice = 'for' | 'against' | 'abstain'

export type AgendaVoteRow = {
  agenda_item_id: string
  user_id: string
  vote: VoteChoice
}

export type LinkLike = { user_id: string; unit_id: string }

export type AgendaVoteTotals = {
  forCount: number
  againstCount: number
  abstainCount: number
  forShare: number
  againstShare: number
  abstainShare: number
  votedOwners: number
  eligibleOwners: number
  eligibleUnits: number
  eligibleShareTotal: number
  notVotedOwners: number
  /** Праг за приемане в проценти от eligibleShareTotal (за обикновено мнозинство = 50). */
  requiredPercent: number
  /** Делът „за“ като % от eligibleShareTotal (NaN ако eligibleShareTotal = 0). */
  forPercentOfEligible: number
  /** TRUE ако forShare > 50% от eligibleShareTotal (строго „повече от половината“). */
  passed: boolean
}

/** Праг за решение по точка — обикновено мнозинство: повече от 50% от присъстващите ид. части. */
export const DECISION_REQUIRED_PERCENT = 50

function shareNum(
  unitId: string,
  shareByUnitId: Map<string, number | null | undefined>
): number {
  const v = shareByUnitId.get(unitId)
  if (v == null || Number.isNaN(Number(v))) return 0
  return Number(v)
}

/** Собственици с поне един присъстващ обект. */
export function eligibleOwnerIds(
  attendeeUnitIds: ReadonlySet<string>,
  links: ReadonlyArray<LinkLike>
): Set<string> {
  const s = new Set<string>()
  for (const l of links) {
    if (attendeeUnitIds.has(l.unit_id)) s.add(l.user_id)
  }
  return s
}

/** Сума ид. части по всички присъстващи обекти на потребителя. */
export function voterIdealShareWeight(
  userId: string,
  attendeeUnitIds: ReadonlySet<string>,
  links: ReadonlyArray<LinkLike>,
  shareByUnitId: Map<string, number | null | undefined>
): number {
  let w = 0
  for (const l of links) {
    if (l.user_id !== userId) continue
    if (!attendeeUnitIds.has(l.unit_id)) continue
    w += shareNum(l.unit_id, shareByUnitId)
  }
  return w
}

/**
 * Обобщение по точка: един глас на собственик; ид. части за страна =
 * сума от присъстващите обекти на гласувалите за тази страна.
 */
export function aggregateAgendaVotesForItem(
  agendaItemId: string,
  votes: ReadonlyArray<AgendaVoteRow>,
  attendeeUnitIds: ReadonlySet<string>,
  links: ReadonlyArray<LinkLike>,
  shareByUnitId: Map<string, number | null | undefined>
): AgendaVoteTotals {
  const owners = eligibleOwnerIds(attendeeUnitIds, links)

  let forCount = 0
  let againstCount = 0
  let abstainCount = 0
  let forShare = 0
  let againstShare = 0
  let abstainShare = 0

  const votedOwners = new Set<string>()

  for (const v of votes) {
    if (v.agenda_item_id !== agendaItemId || !owners.has(v.user_id)) continue
    votedOwners.add(v.user_id)
    const w = voterIdealShareWeight(v.user_id, attendeeUnitIds, links, shareByUnitId)
    if (v.vote === 'for') {
      forCount++
      forShare += w
    } else if (v.vote === 'against') {
      againstCount++
      againstShare += w
    } else {
      abstainCount++
      abstainShare += w
    }
  }

  let eligibleShareTotal = 0
  for (const uid of attendeeUnitIds) {
    eligibleShareTotal += shareNum(uid, shareByUnitId)
  }

  const forPercentOfEligible =
    eligibleShareTotal > 0 ? (forShare / eligibleShareTotal) * 100 : 0
  const passed = eligibleShareTotal > 0 && forPercentOfEligible > DECISION_REQUIRED_PERCENT

  return {
    forCount,
    againstCount,
    abstainCount,
    forShare,
    againstShare,
    abstainShare,
    votedOwners: votedOwners.size,
    eligibleOwners: owners.size,
    eligibleUnits: attendeeUnitIds.size,
    eligibleShareTotal,
    notVotedOwners: owners.size - votedOwners.size,
    requiredPercent: DECISION_REQUIRED_PERCENT,
    forPercentOfEligible,
    passed,
  }
}
