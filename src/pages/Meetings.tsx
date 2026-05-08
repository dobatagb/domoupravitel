import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  Calendar,
  Trash2,
  ArrowLeft,
  Save,
  Loader2,
  FileText,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Users,
  Target,
  Building2,
  ListChecks,
  Vote,
} from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './Meetings.css'
import {
  compareUnitNumberStrings,
  formatUnitNumberDisplay,
  primaryApartmentSortKey,
  sortUnitsApartmentFirst,
} from '../lib/unitNumber'
import {
  evaluateQuorum,
  type QuorumEvaluation,
} from '../lib/meetingQuorum'
import {
  aggregateAgendaVotesForItem,
  type AgendaVoteRow,
} from '../lib/meetingVoteAggregate'
import MeetingAgendaSection, { type AgendaItemRow } from '../components/MeetingAgendaSection'
import { useConfirm } from '../components/ConfirmDialog'

type MeetingStatus = 'draft' | 'active' | 'closed'

type MeetingRow = {
  id: string
  title: string
  convening_started_at: string
  created_at: string
  notes?: string | null
  status: MeetingStatus
  convening_notice_posted_at?: string | null
}

const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  draft: 'Чернова',
  active: 'Активно',
  closed: 'Приключено',
}

const NOTICE_REQUIRED_DAYS = 7
const NOTICE_REQUIRED_MS = NOTICE_REQUIRED_DAYS * 24 * 60 * 60 * 1000

function noticePostedDateValue(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type UnitRow = {
  id: string
  type?: string
  number: string
  building_ideal_share_percent?: number | string | null
  group?: { name: string; code?: string | null } | null
}

type LinkRow = {
  user_id: string
  unit_id: string
}

type AttendeeRow = {
  meeting_id: string
  unit_id: string
  attendee_name: string | null
}

type DraftRow = {
  unit_id: string
  attendee_name: string
}

function unitLabel(u: UnitRow): string {
  const g = u.group?.name?.trim()
  const n = formatUnitNumberDisplay(u.number)
  return g ? `${g} ${n}` : n
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${y}-${m}-${day}T${h}:${min}`
}

function parseIdealShare(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

type AppUserEmail = { id: string; email: string }

type OwnerUnitGroup = {
  key: string
  title: string
  units: UnitRow[]
}

/** Групира обекти по собственик (user_unit_links). Един собственик → ап., гараж и т.н. заедно. */
function buildOwnerUnitGroups(
  units: UnitRow[],
  links: LinkRow[],
  emailByUserId: Map<string, string>
): OwnerUnitGroup[] {
  const ownersByUnit = new Map<string, string[]>()
  for (const l of links) {
    const arr = ownersByUnit.get(l.unit_id) ?? []
    if (!arr.includes(l.user_id)) arr.push(l.user_id)
    ownersByUnit.set(l.unit_id, arr)
  }

  const byOwner = new Map<string, UnitRow[]>()
  const multiOwnerUnits: UnitRow[] = []
  const noLinkUnits: UnitRow[] = []

  for (const u of units) {
    const ou = ownersByUnit.get(u.id) ?? []
    if (ou.length === 0) {
      noLinkUnits.push(u)
    } else if (ou.length === 1) {
      const uid = ou[0]
      const list = byOwner.get(uid) ?? []
      list.push(u)
      byOwner.set(uid, list)
    } else {
      multiOwnerUnits.push(u)
    }
  }

  const ownerIds = [...byOwner.keys()].sort((a, b) => {
    const ua = byOwner.get(a) ?? []
    const ub = byOwner.get(b) ?? []
    const cmp = compareUnitNumberStrings(primaryApartmentSortKey(ua), primaryApartmentSortKey(ub))
    if (cmp !== 0) return cmp
    const ea = emailByUserId.get(a) ?? a
    const eb = emailByUserId.get(b) ?? b
    return ea.localeCompare(eb, 'bg', { sensitivity: 'base' })
  })

  const groups: OwnerUnitGroup[] = ownerIds.map((uid) => ({
    key: uid,
    title: emailByUserId.get(uid)?.trim() || `Потребител ${uid.slice(0, 8)}…`,
    units: sortUnitsApartmentFirst(byOwner.get(uid) ?? []),
  }))

  if (multiOwnerUnits.length > 0) {
    groups.push({
      key: '__multi_owner__',
      title: 'Обекти с няколко собственика в системата',
      units: sortUnitsApartmentFirst(multiOwnerUnits),
    })
  }

  if (noLinkUnits.length > 0) {
    groups.push({
      key: '__no_link__',
      title: 'Без връзка към потребител',
      units: sortUnitsApartmentFirst(noLinkUnits),
    })
  }

  return groups
}

export default function Meetings() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const navigate = useNavigate()
  const { canEdit, user } = useAuth()
  const edit = canEdit()
  const confirmAction = useConfirm()

  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [listLoading, setListLoading] = useState(!meetingId)

  const [meeting, setMeeting] = useState<MeetingRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(!!meetingId)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [units, setUnits] = useState<UnitRow[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [appUsers, setAppUsers] = useState<AppUserEmail[]>([])
  const [draftRows, setDraftRows] = useState<DraftRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState('')
  const [serverNow, setServerNow] = useState<Date>(new Date())
  const [timeTick, setTimeTick] = useState(0)

  const [createTitle, setCreateTitle] = useState('')
  const [createStartedAt, setCreateStartedAt] = useState(() =>
    toDatetimeLocalValue(new Date())
  )
  const [creating, setCreating] = useState(false)

  const [saving, setSaving] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [agendaItems, setAgendaItems] = useState<AgendaItemRow[]>([])
  const [agendaVotes, setAgendaVotes] = useState<AgendaVoteRow[]>([])
  const [attendeesAccordionOpen, setAttendeesAccordionOpen] = useState(true)
  /**
   * Запазените в БД присъстващи (snapshot последно успешно записан/зареден). Използва се
   * за изчисляване на кворум, KPI карти и право на гласуване — НЕ draftRows. Така KPI-то
   * не „лъже“ admin-а с маркирани, но незапазени обекти.
   */
  const [savedAttendeeUnitIds, setSavedAttendeeUnitIds] = useState<Set<string>>(() => new Set())
  /** Real-time channel: 'connecting' преди първо subscribe, 'live' при активен канал, 'offline' след грешка/затваряне. */
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')

  const shareByUnitId = useMemo(() => {
    const m = new Map<string, number | null | undefined>()
    for (const u of units) {
      m.set(u.id, parseIdealShare(u.building_ideal_share_percent))
    }
    return m
  }, [units])

  const suggestBundleForUnit = useCallback(
    (unitId: string): { userId: string; unitIds: string[] } | null => {
      if (!unitId) return null
      const onUnit = [...new Set(links.filter((l) => l.unit_id === unitId).map((l) => l.user_id))]
      const multi = onUnit.filter((uid) => links.filter((l) => l.user_id === uid).length > 1)
      if (multi.length !== 1) return null
      const userId = multi[0]
      const unitIds = [...new Set(links.filter((l) => l.user_id === userId).map((l) => l.unit_id))]
      return { userId, unitIds }
    },
    [links]
  )

  const emailByUserId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of appUsers) {
      m.set(u.id, u.email)
    }
    return m
  }, [appUsers])

  const pickerOwnerGroups = useMemo(
    () => buildOwnerUnitGroups(units, links, emailByUserId),
    [units, links, emailByUserId]
  )

  const filteredPickerGroups = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase()
    if (!q) return pickerOwnerGroups
    return pickerOwnerGroups
      .map((g) => ({
        ...g,
        units: g.units.filter((u) => unitLabel(u).toLowerCase().includes(q)),
      }))
      .filter((g) => g.units.length > 0)
  }, [pickerOwnerGroups, pickerFilter])

  const filteredPickerUnitsFlat = useMemo(
    () => filteredPickerGroups.flatMap((g) => g.units),
    [filteredPickerGroups]
  )

  const pendingOwnerBundle = useMemo(() => {
    const have = new Set(draftRows.map((d) => d.unit_id))
    for (const r of draftRows) {
      const s = suggestBundleForUnit(r.unit_id)
      if (!s) continue
      const missing = s.unitIds.filter((id) => !have.has(id))
      if (missing.length > 0) {
        return { ...s, missingIds: missing }
      }
    }
    return null
  }, [draftRows, suggestBundleForUnit])

  const nameByUnitId = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of draftRows) {
      m.set(r.unit_id, r.attendee_name)
    }
    return m
  }, [draftRows])

  const sortedSelectedUnits = useMemo(() => {
    const ids = new Set(draftRows.map((r) => r.unit_id))
    const sel = units.filter((u) => ids.has(u.id))
    return sortUnitsApartmentFirst(sel)
  }, [units, draftRows])

  const summaryOwnerGroups = useMemo(
    () => buildOwnerUnitGroups(sortedSelectedUnits, links, emailByUserId),
    [sortedSelectedUnits, links, emailByUserId]
  )

  /**
   * За гласуване, кворум, KPI и UI справки използваме САМО запазените присъстващи.
   * draftRows е „за редакция“ от admin-а и не се отразява, докато не се натисне „Запази“.
   */
  const attendeeUnitIds = savedAttendeeUnitIds

  /** TRUE ако admin е променил набора от присъстващи или техните имена и не е запазил. */
  const attendeesDirty = useMemo(() => {
    if (draftRows.length !== savedAttendeeUnitIds.size) return true
    for (const r of draftRows) {
      if (!savedAttendeeUnitIds.has(r.unit_id)) return true
    }
    // Различни имена на представители се броят за dirty (само ако вече знаем оригинала —
    // тук се отказваме да следим имена, защото не пазим snapshot на тях; admin ще види
    // dirty само при промяна на набора. Ако е важно, добавяме savedAttendeeNames Map.)
    return false
  }, [draftRows, savedAttendeeUnitIds])

  /** beforeunload warning при опит за затваряне/презареждане с непазени attendees. */
  useEffect(() => {
    if (!attendeesDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Modern браузъри пренебрегват custom message-а, но трябва да върнем нещо за да тригерира prompt.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [attendeesDirty])

  const loadAgendaData = useCallback(async (mid: string) => {
    const { data: items, error: ie } = await supabase
      .from('meeting_agenda_items')
      .select('*')
      .eq('meeting_id', mid)
      .order('sort_order', { ascending: true })
    if (ie) throw ie
    const itemList = (items as AgendaItemRow[]) ?? []
    setAgendaItems(itemList)
    if (itemList.length === 0) {
      setAgendaVotes([])
      return
    }
    const ids = itemList.map((i) => i.id)
    const { data: vdata, error: ve } = await supabase
      .from('meeting_agenda_votes')
      .select('*')
      .in('agenda_item_id', ids)
    if (ve) throw ve
    setAgendaVotes((vdata as AgendaVoteRow[]) ?? [])
  }, [])

  const refreshAgenda = useCallback(async () => {
    if (!meetingId) return
    await loadAgendaData(meetingId)
  }, [meetingId, loadAgendaData])

  const loadMeetingsList = useCallback(async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase
        .from('meetings')
        .select('id, title, convening_started_at, created_at, notes, status, convening_notice_posted_at')
        .order('convening_started_at', { ascending: false })
    )
    if (error) throw error
    setMeetings((data as MeetingRow[]) || [])
  }, [])

  const loadSharedData = useCallback(async () => {
    const [unitRes, linkRes, usersRes] = await Promise.all([
      supabase
        .from('units')
        .select('id, type, number, building_ideal_share_percent, group:group_id(name, code)')
        .eq('archived', false),
      supabase.from('user_unit_links').select('user_id, unit_id'),
      supabase.from('users').select('id, email'),
    ])
    if (unitRes.error) throw unitRes.error
    if (linkRes.error) throw linkRes.error
    if (usersRes.error) {
      console.warn('[Meetings] users email load:', usersRes.error.message)
      setAppUsers([])
    } else {
      setAppUsers((usersRes.data as AppUserEmail[]) || [])
    }
    setUnits(sortUnitsApartmentFirst((unitRes.data as unknown as UnitRow[]) || []))
    setLinks((linkRes.data as LinkRow[]) || [])
  }, [])

  const refreshServerTime = useCallback(async () => {
    const { data, error } = await supabase.rpc('server_now')
    if (!error && data) {
      setServerNow(new Date(data as string))
    } else {
      setServerNow(new Date())
    }
  }, [])

  useEffect(() => {
    if (!meetingId) {
      void (async () => {
        try {
          await Promise.all([loadMeetingsList(), loadSharedData()])
        } catch (e) {
          console.error(e)
        } finally {
          setListLoading(false)
        }
      })()
    }
  }, [meetingId, loadMeetingsList, loadSharedData])

  useEffect(() => {
    if (!meetingId) return
    void (async () => {
      setDetailLoading(true)
      setDetailError(null)
      try {
        await loadSharedData()
        await refreshServerTime()
        const [{ data: mData, error: mErr }, { data: aData, error: aErr }] = await Promise.all([
          supabase
            .from('meetings')
            .select('id, title, convening_started_at, created_at, notes, status, convening_notice_posted_at')
            .eq('id', meetingId)
            .maybeSingle(),
          supabase.from('meeting_attendees').select('*').eq('meeting_id', meetingId),
        ])
        if (mErr) throw mErr
        if (aErr) throw aErr
        if (!mData) {
          setMeeting(null)
          setDetailError('Събранието не е намерено.')
          return
        }
        const row = mData as MeetingRow
        setMeeting(row)
        setNotesDraft(row.notes ?? '')
        const attendees = (aData as AttendeeRow[]) || []
        setDraftRows(
          attendees.map((a) => ({
            unit_id: a.unit_id,
            attendee_name: (a.attendee_name ?? '').trim(),
          }))
        )
        setSavedAttendeeUnitIds(new Set(attendees.map((a) => a.unit_id)))
        try {
          await loadAgendaData(meetingId)
        } catch (agErr) {
          console.warn('[Meetings] agenda load:', agErr)
          setAgendaItems([])
          setAgendaVotes([])
        }
      } catch (e: unknown) {
        console.error(e)
        setDetailError(e instanceof Error ? e.message : 'Грешка при зареждане')
      } finally {
        setDetailLoading(false)
      }
    })()
  }, [meetingId, loadSharedData, refreshServerTime, loadAgendaData])

  const refreshAttendeesFromDb = useCallback(async (mid: string) => {
    const { data, error } = await supabase
      .from('meeting_attendees')
      .select('*')
      .eq('meeting_id', mid)
    if (error) throw error
    const attendees = (data as AttendeeRow[]) ?? []
    setDraftRows(
      attendees.map((a) => ({
        unit_id: a.unit_id,
        attendee_name: (a.attendee_name ?? '').trim(),
      }))
    )
    setSavedAttendeeUnitIds(new Set(attendees.map((a) => a.unit_id)))
  }, [])

  /**
   * Real-time канал за събранието: точки от дневен ред, гласове и присъстващи.
   * Заменя прежния polling на 2.5 сек — Postgres WAL → WebSocket push.
   * Малък debounce (200 ms) пести излишни refresh-и при batch операции.
   */
  useEffect(() => {
    if (!meetingId || !meeting) return

    let agendaTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleAgenda = () => {
      if (agendaTimer) clearTimeout(agendaTimer)
      agendaTimer = setTimeout(() => {
        agendaTimer = null
        void loadAgendaData(meetingId).catch((e) => console.warn('[Meetings] realtime agenda refresh:', e))
      }, 200)
    }

    let attendeesTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleAttendees = () => {
      // Не пипаме draftRows ако админ ги редактира — той ще запише и ще получи push.
      if (edit) return
      if (attendeesTimer) clearTimeout(attendeesTimer)
      attendeesTimer = setTimeout(() => {
        attendeesTimer = null
        void refreshAttendeesFromDb(meetingId).catch((e) =>
          console.warn('[Meetings] realtime attendees refresh:', e)
        )
      }, 200)
    }

    setRealtimeStatus('connecting')

    const channel = supabase
      .channel(`meeting:${meetingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meeting_agenda_items',
          filter: `meeting_id=eq.${meetingId}`,
        },
        scheduleAgenda
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meeting_agenda_votes',
          filter: `meeting_id=eq.${meetingId}`,
        },
        scheduleAgenda
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meeting_attendees',
          filter: `meeting_id=eq.${meetingId}`,
        },
        scheduleAttendees
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('live')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('offline')
        }
      })

    return () => {
      if (agendaTimer) clearTimeout(agendaTimer)
      if (attendeesTimer) clearTimeout(attendeesTimer)
      void supabase.removeChannel(channel)
      setRealtimeStatus('connecting')
    }
  }, [meetingId, meeting, loadAgendaData, refreshAttendeesFromDb, edit])

  useEffect(() => {
    if (!meetingId || !meeting) return
    const t = window.setInterval(() => {
      void refreshServerTime()
      setTimeTick((x) => x + 1)
    }, 45_000)
    return () => window.clearInterval(t)
  }, [meetingId, meeting, refreshServerTime])

  const quorum: QuorumEvaluation | null = useMemo(() => {
    if (!meeting) return null
    const started = new Date(meeting.convening_started_at)
    return evaluateQuorum(started, serverNow, savedAttendeeUnitIds, shareByUnitId, links)
    // timeTick forces recompute when polling bumps serverNow state
  }, [meeting, savedAttendeeUnitIds, serverNow, shareByUnitId, links, timeTick])

  /**
   * Информация за поканата: дни между публикуване и начало.
   * `daysBeforeStart`: NULL ако няма дата на покана; иначе колко цели дни преди начало.
   * `meetsLegalNotice`: TRUE ако дните ≥ 7 (по ЗУЕС минимум).
   */
  const noticeInfo = useMemo(() => {
    if (!meeting?.convening_notice_posted_at) {
      return { daysBeforeStart: null as number | null, meetsLegalNotice: false }
    }
    const posted = new Date(meeting.convening_notice_posted_at).getTime()
    const start = new Date(meeting.convening_started_at).getTime()
    const diffMs = start - posted
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
    return { daysBeforeStart: days, meetsLegalNotice: diffMs >= NOTICE_REQUIRED_MS }
  }, [meeting?.convening_notice_posted_at, meeting?.convening_started_at])

  const isClosedMeeting = meeting?.status === 'closed'
  const isDraftMeeting = meeting?.status === 'draft'

  /** Редакция на присъстващи и точки е блокирана при `closed` (admin може да преоткрие). */
  const editLive = edit && !isClosedMeeting

  /** Брой затворени точки и от тях — приети/отхвърлени (за KPI „Дневен ред"). */
  const agendaDecisionStats = useMemo(() => {
    let closed = 0
    let passed = 0
    for (const item of agendaItems) {
      if (item.voting_status !== 'closed') continue
      closed++
      const totals = aggregateAgendaVotesForItem(
        item.id,
        agendaVotes,
        attendeeUnitIds,
        links,
        shareByUnitId
      )
      if (totals.passed) passed++
    }
    return { closed, passed, rejected: closed - passed }
  }, [agendaItems, agendaVotes, attendeeUnitIds, links, shareByUnitId])

  const phaseLabel = (phase: QuorumEvaluation['phase']) =>
    phase === 'first' ? 'Първо свикване' : 'Второ свикване'

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!edit) return
    setCreating(true)
    try {
      const convening_started_at = new Date(createStartedAt).toISOString()
      const { data, error } = await supabase
        .from('meetings')
        .insert({
          title: createTitle.trim() || 'Събрание',
          convening_started_at,
        })
        .select('id')
        .single()
      if (error) throw error
      const id = (data as { id: string }).id
      navigate(`/meetings/${id}`)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при създаване')
    } finally {
      setCreating(false)
    }
  }

  const setUnitPresent = useCallback((unitId: string, present: boolean) => {
    setDraftRows((rows) => {
      if (!present) return rows.filter((r) => r.unit_id !== unitId)
      if (rows.some((r) => r.unit_id === unitId)) return rows
      return [...rows, { unit_id: unitId, attendee_name: '' }]
    })
  }, [])

  const setUnitAttendeeName = useCallback((unitId: string, name: string) => {
    setDraftRows((rows) =>
      rows.map((r) => (r.unit_id === unitId ? { ...r, attendee_name: name } : r))
    )
  }, [])

  const selectAllFilteredInPicker = useCallback(() => {
    setDraftRows((rows) => {
      const have = new Set(rows.map((r) => r.unit_id))
      const next = [...rows]
      for (const u of filteredPickerUnitsFlat) {
        if (!have.has(u.id)) {
          have.add(u.id)
          next.push({ unit_id: u.id, attendee_name: '' })
        }
      }
      return next
    })
  }, [filteredPickerUnitsFlat])

  const clearFilteredInPicker = useCallback(() => {
    const drop = new Set(filteredPickerUnitsFlat.map((u) => u.id))
    setDraftRows((rows) => rows.filter((r) => !drop.has(r.unit_id)))
  }, [filteredPickerUnitsFlat])

  const openAttendeePicker = useCallback(() => {
    setPickerFilter('')
    setPickerOpen(true)
  }, [])

  const applySuggestAll = (unitIds: string[]) => {
    setDraftRows((rows) => {
      const existing = new Set(rows.map((r) => r.unit_id).filter(Boolean))
      const additions: DraftRow[] = []
      for (const uid of unitIds) {
        if (!existing.has(uid)) {
          existing.add(uid)
          additions.push({ unit_id: uid, attendee_name: '' })
        }
      }
      return [...rows, ...additions]
    })
  }

  const handleSaveAttendees = async () => {
    if (!edit || !meetingId) return
    const cleaned = draftRows.filter((r) => r.unit_id)
    const ids = cleaned.map((r) => r.unit_id)
    if (new Set(ids).size !== ids.length) {
      alert('Има дублиран обект — махни повторенията.')
      return
    }
    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('meeting_attendees')
        .delete()
        .eq('meeting_id', meetingId)
      if (delErr) throw delErr
      if (cleaned.length > 0) {
        const { error: insErr } = await supabase.from('meeting_attendees').insert(
          cleaned.map((r) => ({
            meeting_id: meetingId,
            unit_id: r.unit_id,
            attendee_name: r.attendee_name.trim() || null,
          }))
        )
        if (insErr) throw insErr
      }
      setSavedAttendeeUnitIds(new Set(ids))
      await refreshServerTime()
      await refreshAgenda()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  const handleClearAttendees = useCallback(async () => {
    if (!edit) return
    const ok = await confirmAction({
      title: 'Изчистване на избора',
      message: 'Сигурни ли сте, че искате да премахнете всички маркирани обекти от черновата?',
      confirmLabel: 'Изчисти',
      cancelLabel: 'Отказ',
      variant: 'danger',
    })
    if (!ok) return
    setDraftRows([])
  }, [edit, confirmAction])

  const handleSaveNotes = async () => {
    if (!edit || !meetingId) return
    setSavingNotes(true)
    try {
      const { error } = await supabase
        .from('meetings')
        .update({ notes: notesDraft.trim() || null })
        .eq('id', meetingId)
      if (error) throw error
      setMeeting((prev) => (prev ? { ...prev, notes: notesDraft.trim() || null } : prev))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Грешка при запис на протокола')
    } finally {
      setSavingNotes(false)
    }
  }

  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNoticeDate, setSavingNoticeDate] = useState(false)

  const handleChangeStatus = useCallback(
    async (next: MeetingStatus) => {
      if (!edit || !meetingId || !meeting) return
      if (next === meeting.status) return
      const verbs: Record<MeetingStatus, string> = {
        draft: 'върне в чернова',
        active: 'свика като активно',
        closed: 'приключи',
      }
      const messages: Record<MeetingStatus, string> = {
        draft: 'Връщането в чернова ще скрие събранието от потребителите и ще спре кворум/нотификации.',
        active:
          'Това ще уведоми всички собственици с регистриран обект, че събранието е свикано (in-app, а скоро и по email).',
        closed: 'Приключеното събрание не позволява промени по присъстващи и точки през UI.',
      }
      const ok = await confirmAction({
        title: `Сигурни ли сте, че искате събранието да се ${verbs[next]}?`,
        message: messages[next],
        confirmLabel: next === 'closed' ? 'Приключи' : next === 'active' ? 'Свикай' : 'Върни в чернова',
        variant: next === 'closed' ? 'danger' : 'default',
      })
      if (!ok) return
      setSavingStatus(true)
      try {
        const { error } = await supabase
          .from('meetings')
          .update({ status: next })
          .eq('id', meetingId)
        if (error) throw error
        setMeeting((prev) => (prev ? { ...prev, status: next } : prev))
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : 'Грешка при промяна на статуса')
      } finally {
        setSavingStatus(false)
      }
    },
    [edit, meetingId, meeting, confirmAction]
  )

  const handleSaveNoticeDate = useCallback(
    async (dateStr: string) => {
      if (!edit || !meetingId) return
      setSavingNoticeDate(true)
      try {
        const iso = dateStr ? new Date(dateStr + 'T00:00:00').toISOString() : null
        const { error } = await supabase
          .from('meetings')
          .update({ convening_notice_posted_at: iso })
          .eq('id', meetingId)
        if (error) throw error
        setMeeting((prev) =>
          prev ? { ...prev, convening_notice_posted_at: iso } : prev
        )
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : 'Грешка при запис на дата на покана')
      } finally {
        setSavingNoticeDate(false)
      }
    },
    [edit, meetingId]
  )

  const handleDeleteMeeting = async () => {
    if (!edit || !meetingId || !meeting) return
    const ok = await confirmAction({
      title: 'Изтриване на събрание',
      message: `Сигурни ли сте, че искате да изтриете събрание „${meeting.title || 'Събрание'}“?\n\nЩе се изтрият всички присъстващи, точки от дневен ред, гласове и протокол. Действието не може да се отмени.`,
      confirmLabel: 'Изтрий',
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', meetingId)
      if (error) throw error
      navigate('/meetings')
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Грешка при изтриване')
    } finally {
      setDeleting(false)
    }
  }

  if (meetingId) {
    if (detailLoading) {
      return (
        <div className="meetings-page">
          <p className="meetings-empty">
            <Loader2 size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} aria-hidden />
            Зареждане…
          </p>
        </div>
      )
    }

    if (detailError || !meeting) {
      return (
        <div className="meetings-page">
          <Link to="/meetings" className="meetings-back-link">
            <ArrowLeft size={18} aria-hidden /> Към списъка
          </Link>
          <p className="meetings-empty">{detailError ?? 'Няма данни.'}</p>
        </div>
      )
    }

    return (
      <div className="meetings-page meetings-detail">
        <Link to="/meetings" className="meetings-back-link">
          <ArrowLeft size={18} aria-hidden /> Към списъка
        </Link>

        <header className="meetings-hero">
          <div className="meetings-hero-main">
            <div className="meetings-hero-titlewrap">
              <h1 className="meetings-hero-title">{meeting.title?.trim() || 'Събрание'}</h1>
              <span
                className={`meetings-meeting-status-pill meetings-meeting-status-pill--${meeting.status}`}
                title="Статус на събранието"
              >
                {MEETING_STATUS_LABEL[meeting.status]}
              </span>
              {meeting.status !== 'draft' && quorum && (
                <span
                  className={`meetings-status-pill ${quorum.quorumMet ? 'meetings-status-pill--ok' : 'meetings-status-pill--no'}`}
                  title="Текущо състояние на кворум"
                >
                  {quorum.quorumMet ? (
                    <CheckCircle2 size={14} aria-hidden />
                  ) : (
                    <AlertCircle size={14} aria-hidden />
                  )}
                  {quorum.quorumMet ? 'Има кворум' : 'Няма кворум'}
                </span>
              )}
              <span
                className={`meetings-realtime-pill meetings-realtime-pill--${realtimeStatus}`}
                title={
                  realtimeStatus === 'live'
                    ? 'Получавате актуализации в реално време'
                    : realtimeStatus === 'connecting'
                      ? 'Свързване към канал за актуализации…'
                      : 'Каналът е прекъснат — данните може да не са актуални'
                }
              >
                <span className="meetings-realtime-dot" aria-hidden />
                {realtimeStatus === 'live'
                  ? 'На живо'
                  : realtimeStatus === 'connecting'
                    ? 'Свързване…'
                    : 'Офлайн'}
              </span>
            </div>
            <div className="meetings-hero-meta">
              <span className="meetings-hero-meta-item">
                <Calendar size={15} aria-hidden />
                Начало:{' '}
                <strong>
                  {format(new Date(meeting.convening_started_at), 'dd.MM.yyyy HH:mm', { locale: bg })}
                </strong>
              </span>
              {quorum && (
                <span className="meetings-hero-meta-item">
                  <Users size={15} aria-hidden />
                  {phaseLabel(quorum.phase)}
                  {quorum.elevated ? ' · повишен праг 75 %' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="meetings-hero-actions">
            <a
              className="btn-secondary btn-small"
              href={`/meetings/${meetingId}/print`}
              target="_blank"
              rel="noopener noreferrer"
              title="Отвори в нов раздел и принтирай (или запиши като PDF)"
            >
              <FileText size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} aria-hidden />
              Печат / PDF
            </a>
          </div>
          {edit && (
            <div className="meetings-hero-actions">
              {meeting.status === 'draft' ? (
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={savingStatus}
                  onClick={() => void handleChangeStatus('active')}
                  title="Свиква събранието и уведомява всички собственици"
                >
                  {savingStatus ? '…' : 'Свикай събранието'}
                </button>
              ) : null}
              {meeting.status === 'active' ? (
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  disabled={savingStatus}
                  onClick={() => void handleChangeStatus('closed')}
                  title="Приключва събранието; точките и присъстващите вече не се променят"
                >
                  {savingStatus ? '…' : 'Приключи събранието'}
                </button>
              ) : null}
              {meeting.status === 'closed' ? (
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  disabled={savingStatus}
                  onClick={() => void handleChangeStatus('active')}
                  title="Преоткрива събранието (за корекции)"
                >
                  {savingStatus ? '…' : 'Преоткрий'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-secondary btn-small meetings-hero-delete"
                disabled={deleting}
                onClick={() => void handleDeleteMeeting()}
                title="Изтрий това събрание"
              >
                <Trash2 size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} aria-hidden />
                {deleting ? '…' : 'Изтрий'}
              </button>
            </div>
          )}
        </header>

        {isDraftMeeting ? (
          <div className="meetings-banner meetings-banner--draft" role="note">
            <strong>Чернова.</strong> Това събрание още не е свикано — потребителите не са уведомени и
            няма да се мери кворум. {edit ? 'Натиснете „Свикай събранието“ когато сте готови.' : null}
          </div>
        ) : null}
        {isClosedMeeting ? (
          <div className="meetings-banner meetings-banner--closed" role="note">
            <strong>Приключено.</strong> Събранието е закрито. Промени в присъстващите/точките
            не би следвало да се правят (възможни са само за административна корекция).
          </div>
        ) : null}

        <div className="meetings-notice-row">
          <div className="meetings-notice-row-main">
            <span className="meetings-notice-label">Дата на публикувана покана:</span>
            {edit && !isClosedMeeting ? (
              <input
                type="date"
                className="meetings-notice-input"
                value={noticePostedDateValue(meeting.convening_notice_posted_at)}
                disabled={savingNoticeDate}
                onChange={(e) => void handleSaveNoticeDate(e.target.value)}
                aria-label="Дата на публикувана покана"
              />
            ) : (
              <strong>
                {meeting.convening_notice_posted_at
                  ? format(new Date(meeting.convening_notice_posted_at), 'dd.MM.yyyy', { locale: bg })
                  : 'не е въведена'}
              </strong>
            )}
          </div>
          {meeting.convening_notice_posted_at && noticeInfo.daysBeforeStart != null ? (
            <span
              className={`meetings-notice-status meetings-notice-status--${noticeInfo.meetsLegalNotice ? 'ok' : 'warn'}`}
              title={`По ЗУЕС поканата трябва да е публикувана поне ${NOTICE_REQUIRED_DAYS} дни преди начало.`}
            >
              {noticeInfo.meetsLegalNotice ? (
                <>
                  <CheckCircle2 size={14} aria-hidden /> {noticeInfo.daysBeforeStart} дни преди начало
                </>
              ) : (
                <>
                  <AlertCircle size={14} aria-hidden /> Само {Math.max(noticeInfo.daysBeforeStart, 0)}{' '}
                  дни преди начало (минимум {NOTICE_REQUIRED_DAYS})
                </>
              )}
            </span>
          ) : null}
        </div>

        <nav className="meetings-subnav" aria-label="Бърз достъп до секции">
          <a href="#section-attendees" className="meetings-subnav-chip">
            <Users size={14} aria-hidden /> Присъстващи
          </a>
          <a href="#section-agenda" className="meetings-subnav-chip">
            <Vote size={14} aria-hidden /> Дневен ред
          </a>
          <a href="#section-protocol" className="meetings-subnav-chip">
            <FileText size={14} aria-hidden /> Протокол
          </a>
        </nav>

        <section
          id="section-attendees"
          className="meetings-card meetings-section meetings-presence-card"
          aria-label="Присъствие и кворум"
        >
          <div className="meetings-section-head">
            <span className="meetings-section-eyebrow">Присъствие</span>
            <h2 className="meetings-section-title">
              <Users size={18} aria-hidden /> Присъствие и кворум
            </h2>
            <p className="meetings-section-desc">
              Запазени <strong>{savedAttendeeUnitIds.size}</strong> от <strong>{units.length}</strong> обекта.
              {attendeesDirty ? (
                <span className="meetings-section-dirty">
                  {' '}· В чернова: <strong>{draftRows.length}</strong> — натиснете „Запази“, за да влязат в сила.
                </span>
              ) : null}
            </p>
          </div>
          {quorum ? (() => {
            const representedPct = quorum.representedPercent
            const thresholdPct = quorum.thresholdPercent
            const denom = Math.max(thresholdPct, representedPct, 1)
            const fillPct = Math.max(2, Math.min(100, Math.round((representedPct / denom) * 100)))
            const markPct = Math.max(0, Math.min(100, (thresholdPct / denom) * 100))
            return (
              <div className="meetings-kpi-wrap">
                <div className="meetings-kpi" aria-label="Кворум — обобщение">
                  <div className={`meetings-kpi-card meetings-kpi-card--status ${quorum.quorumMet ? 'is-ok' : 'is-no'}`}>
                    <span className="meetings-kpi-label">Кворум</span>
                    <span className="meetings-kpi-value">
                      {quorum.quorumMet ? 'Има се' : 'Няма се'}
                    </span>
                    <span className="meetings-kpi-sub">Праг {thresholdPct}%</span>
                  </div>
                  <div className="meetings-kpi-card">
                    <span className="meetings-kpi-label">
                      <Target size={14} aria-hidden /> Представени ид. части
                    </span>
                    <span className="meetings-kpi-value meetings-num">
                      {representedPct.toFixed(2)}
                      <span className="meetings-kpi-unit">%</span>
                    </span>
                    <span className="meetings-kpi-sub">от регистрираните</span>
                  </div>
                  <div className="meetings-kpi-card">
                    <span className="meetings-kpi-label">
                      <Building2 size={14} aria-hidden /> Присъстващи обекти
                    </span>
                    <span className="meetings-kpi-value meetings-num">
                      {savedAttendeeUnitIds.size}
                      <span className="meetings-kpi-unit"> / {units.length}</span>
                    </span>
                    <span className="meetings-kpi-sub">
                      {attendeesDirty
                        ? `${draftRows.length} в чернова — натиснете „Запази“`
                        : 'запазени'}
                    </span>
                  </div>
                  <div className="meetings-kpi-card">
                    <span className="meetings-kpi-label">
                      <ListChecks size={14} aria-hidden /> Дневен ред
                    </span>
                    <span className="meetings-kpi-value meetings-num">{agendaItems.length}</span>
                    <span className="meetings-kpi-sub">
                      {agendaItems.length === 0
                        ? 'няма още'
                        : agendaDecisionStats.closed === 0
                          ? 'няма гласувани'
                          : `${agendaDecisionStats.passed} приети · ${agendaDecisionStats.rejected} отхвърлени`}
                    </span>
                  </div>
                </div>
                <div
                  className={`meetings-quorum-progress ${quorum.quorumMet ? 'is-ok' : 'is-no'}`}
                  aria-label="Прогрес към праг"
                >
                  <div className="meetings-quorum-progress-bar" aria-hidden>
                    <div className="meetings-quorum-progress-fill" style={{ width: `${fillPct}%` }} />
                    <div className="meetings-quorum-progress-mark" style={{ left: `${markPct}%` }} />
                  </div>
                  <div className="meetings-quorum-progress-meta">
                    <span>
                      <strong className="meetings-num">{representedPct.toFixed(4)}%</strong> представени
                      {' '}· праг <strong className="meetings-num">{thresholdPct}%</strong>
                      {' '}({phaseLabel(quorum.phase)}
                      {quorum.elevated ? ', повишен праг 75 %' : ''})
                    </span>
                    <span className="meetings-quorum-progress-time">
                      Сървърно време: {format(serverNow, 'dd.MM.yyyy HH:mm:ss', { locale: bg })}
                    </span>
                  </div>
                </div>
              </div>
            )
          })() : null}

          <div className="meetings-attendees-accordion">
            <button
              type="button"
              className="meetings-attendees-accordion-trigger"
              id="meetings-attendees-heading"
              aria-expanded={attendeesAccordionOpen}
              aria-controls="meetings-attendees-panel"
              onClick={() => setAttendeesAccordionOpen((o) => !o)}
            >
              <ChevronDown
                size={22}
                className={`meetings-attendees-accordion-chevron${attendeesAccordionOpen ? ' is-open' : ''}`}
                aria-hidden
              />
              <span className="meetings-attendees-accordion-title-wrap">
                <span className="meetings-attendees-accordion-title">
                  {attendeesAccordionOpen ? 'Скрий списъка по обект' : 'Покажи списъка по обект'}
                </span>
              </span>
            </button>

            {attendeesAccordionOpen ? (
              <div
                id="meetings-attendees-panel"
                role="region"
                aria-labelledby="meetings-attendees-heading"
                className="meetings-attendees-accordion-panel"
              >
                {editLive && (
                  <div className="meetings-form-actions" style={{ marginBottom: '1rem' }}>
                    <button type="button" className="btn-primary" onClick={openAttendeePicker}>
                      Избор на обекти…
                    </button>
                  </div>
                )}

                <div className="meetings-summary-groups">
                  {sortedSelectedUnits.length === 0 ? (
                    <p className="meetings-empty">Няма маркирани обекти.</p>
                  ) : (
                    summaryOwnerGroups.map((group) => (
                      <div key={group.key} className="meetings-summary-block">
                        <div className="meetings-summary-owner">{group.title}</div>
                        <div className="meetings-table-wrap">
                          <table className="meetings-table">
                            <thead>
                              <tr>
                                <th>Обект</th>
                                <th>Ид. части</th>
                                <th>Представител</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.units.map((u) => {
                                const pct = parseIdealShare(u.building_ideal_share_percent)
                                const rep = (nameByUnitId.get(u.id) ?? '').trim()
                                return (
                                  <tr key={u.id}>
                                    <td>{unitLabel(u)}</td>
                                    <td className="meetings-num">{pct != null ? `${pct}%` : '—'}</td>
                                    <td>{rep || '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {editLive && (
                  <div className="meetings-form-actions">
                    <button
                      type="button"
                      className={`btn-primary${attendeesDirty ? ' btn-primary--dirty' : ''}`}
                      disabled={saving || !attendeesDirty}
                      onClick={() => void handleSaveAttendees()}
                      title={attendeesDirty ? 'Има непазени промени' : 'Няма промени за запазване'}
                    >
                      <Save size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                      {saving
                        ? 'Запис…'
                        : attendeesDirty
                          ? 'Запази промените'
                          : 'Няма промени'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={handleClearAttendees}>
                      Изчисти избора
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <section id="section-agenda" className="meetings-section meetings-agenda-wrap" aria-label="Дневен ред">
        <MeetingAgendaSection
          meetingId={meetingId}
          userId={user?.id}
          edit={editLive}
          attendeeUnitIds={attendeeUnitIds}
          links={links}
          agendaItems={agendaItems}
          votes={agendaVotes}
          shareByUnitId={shareByUnitId}
          appUsers={appUsers}
          onRefresh={refreshAgenda}
        />
        </section>

        <section id="section-protocol" className="meetings-card meetings-section meetings-protocol-card" aria-label="Протокол">
          <div className="meetings-section-head">
            <span className="meetings-section-eyebrow">Документ</span>
            <h2 className="meetings-section-title">
              <FileText size={18} aria-hidden /> Протокол и решения
            </h2>
            <p className="meetings-section-desc">
              Описват се дневен ред, решения и бележки — видими за всички регистрирани потребители.
            </p>
          </div>
          {edit ? (
            <>
              <textarea
                className="meetings-protocol-textarea"
                id="meeting-notes"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Напр. приети решения, гласуване по точки, забележки…"
                rows={14}
                spellCheck
              />
              <div className="meetings-form-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingNotes}
                  onClick={() => void handleSaveNotes()}
                >
                  <Save size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                  {savingNotes ? 'Запис…' : 'Запази протокола'}
                </button>
              </div>
            </>
          ) : notesDraft.trim() ? (
            <pre className="meetings-protocol-readonly">{notesDraft}</pre>
          ) : (
            <p className="meetings-empty">Няма въведен протокол.</p>
          )}
        </section>

        {pickerOpen && editLive && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal
            aria-labelledby="meetings-picker-title"
            onClick={() => setPickerOpen(false)}
          >
            <div
              className="modal-content meetings-picker-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="meetings-picker-title">Присъстващи обекти</h2>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: 'var(--text-light)' }}>
                Обектите са подредени по собственик (както в «Потребители»). Маркирай с отметка; полето
                „Представител“ е по желание.
              </p>
              <input
                className="meetings-picker-search"
                type="search"
                placeholder="Търси обект…"
                value={pickerFilter}
                onChange={(e) => setPickerFilter(e.target.value)}
                autoComplete="off"
              />
              <div className="meetings-picker-toolbar">
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={selectAllFilteredInPicker}
                >
                  Всички видими
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={clearFilteredInPicker}
                >
                  Махни видимите
                </button>
              </div>
              <div className="meetings-picker-list">
                {filteredPickerGroups.length === 0 ? (
                  <p className="meetings-empty" style={{ padding: '1rem 0.75rem', margin: 0 }}>
                    Няма обекти по този филтър.
                  </p>
                ) : (
                  filteredPickerGroups.map((group) => (
                    <section key={group.key} className="meetings-picker-group">
                      <h3 className="meetings-picker-group-title">{group.title}</h3>
                      {group.units.map((u) => {
                        const checked = draftRows.some((r) => r.unit_id === u.id)
                        const pct = parseIdealShare(u.building_ideal_share_percent)
                        return (
                          <div key={u.id} className="meetings-picker-row">
                            <label className="meetings-picker-unit-label">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setUnitPresent(u.id, e.target.checked)}
                              />
                              <span className="meetings-picker-unit-text">
                                {unitLabel(u)}
                                <span className="meetings-picker-pct">
                                  {' '}
                                  · {pct != null ? `${pct}%` : '—'}
                                </span>
                              </span>
                            </label>
                            <input
                              type="text"
                              className="meetings-picker-name"
                              placeholder="Представител"
                              value={nameByUnitId.get(u.id) ?? ''}
                              disabled={!checked}
                              onChange={(e) => setUnitAttendeeName(u.id, e.target.value)}
                              aria-label={`Представител за ${unitLabel(u)}`}
                            />
                          </div>
                        )
                      })}
                    </section>
                  ))
                )}
              </div>
              {pendingOwnerBundle && (
                <div className="meetings-picker-hint">
                  Един от маркираните собственици има още свързани обекти.{' '}
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    onClick={() => applySuggestAll(pendingOwnerBundle.unitIds)}
                  >
                    Добави всички негови обекти (
                    {pendingOwnerBundle.missingIds.length} нови)
                  </button>
                </div>
              )}
              <div className="meetings-picker-footer">
                <button type="button" className="btn-primary" onClick={() => setPickerOpen(false)}>
                  Готово
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="meetings-page">
      <div className="meetings-page-header">
        <h1>
          <Calendar className="announcements-title-icon" size={28} aria-hidden />
          Събрания
        </h1>
      </div>

      {edit && (
        <div className="meetings-card">
          <h2>Ново събрание</h2>
          <form onSubmit={(e) => void handleCreate(e)}>
            <div className="meetings-form-grid">
              <div className="form-group">
                <label htmlFor="meet-title">Заглавие</label>
                <input
                  id="meet-title"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Напр. Общо събрание — март"
                />
              </div>
              <div className="form-group">
                <label htmlFor="meet-start">Начало на отброяване</label>
                <input
                  id="meet-start"
                  type="datetime-local"
                  value={createStartedAt}
                  onChange={(e) => setCreateStartedAt(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="meetings-form-actions">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Създаване…' : 'Създай'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="meetings-card">
        <h2>Списък</h2>
        {listLoading ? (
          <p className="meetings-empty">Зареждане…</p>
        ) : meetings.length === 0 ? (
          <p className="meetings-empty">Все още няма събрания.</p>
        ) : (
          <ul className="meetings-list">
            {meetings.map((m) => (
              <li key={m.id} className="meetings-list-item">
                <div>
                  <Link to={`/meetings/${m.id}`}>{m.title?.trim() || 'Събрание'}</Link>
                  <div className="meetings-meta">
                    <span
                      className={`meetings-meeting-status-pill meetings-meeting-status-pill--${m.status}`}
                      title="Статус на събранието"
                    >
                      {MEETING_STATUS_LABEL[m.status]}
                    </span>
                    {' '}
                    {format(new Date(m.convening_started_at), 'dd.MM.yyyy HH:mm', { locale: bg })}
                    {m.notes?.trim() ? (
                      <span className="meetings-list-protocol-tag"> · Протокол</span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
