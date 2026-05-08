import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { bg } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { aggregateAgendaVotesForItem, type AgendaVoteRow } from '../lib/meetingVoteAggregate'
import { evaluateQuorum, type MeetingPhase, type QuorumEvaluation } from '../lib/meetingQuorum'
import { sortUnitsApartmentFirst, formatUnitNumberDisplay } from '../lib/unitNumber'

function parseIdealShare(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
import './MeetingPrint.css'

type MeetingRow = {
  id: string
  title: string
  convening_started_at: string
  notes: string | null
  status: 'draft' | 'active' | 'closed'
  convening_notice_posted_at: string | null
}

type AttendeeRow = {
  meeting_id: string
  unit_id: string
  attendee_name: string | null
}

type AgendaItemRow = {
  id: string
  meeting_id: string
  title: string
  description: string | null
  position: number
  voting_status: 'pending' | 'open' | 'closed'
}

type UnitRow = {
  id: string
  type?: string
  number: string
  building_ideal_share_percent?: number | string | null
  group?: { name: string; code?: string | null } | null
}

type LinkRow = { user_id: string; unit_id: string }

type AppUser = { id: string; email: string | null }

const STATUS_LABEL: Record<MeetingRow['status'], string> = {
  draft: 'Чернова',
  active: 'Активно',
  closed: 'Приключено',
}

const PHASE_LABEL: Record<MeetingPhase, string> = {
  first: 'Първо свикване',
  second: 'Второ свикване',
}

export default function MeetingPrint() {
  const { meetingId } = useParams<{ meetingId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meeting, setMeeting] = useState<MeetingRow | null>(null)
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [agendaItems, setAgendaItems] = useState<AgendaItemRow[]>([])
  const [agendaVotes, setAgendaVotes] = useState<AgendaVoteRow[]>([])
  const [units, setUnits] = useState<UnitRow[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [emailByUserId, setEmailByUserId] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    if (!meetingId) {
      setError('Липсва идентификатор на събрание.')
      setLoading(false)
      return
    }
    const load = async () => {
      try {
        const [m, att, ai, av, u, l, usrs] = await Promise.all([
          supabase
            .from('meetings')
            .select('id, title, convening_started_at, notes, status, convening_notice_posted_at')
            .eq('id', meetingId)
            .maybeSingle(),
          supabase.from('meeting_attendees').select('*').eq('meeting_id', meetingId),
          supabase
            .from('meeting_agenda_items')
            .select('id, meeting_id, title, description, position, voting_status')
            .eq('meeting_id', meetingId)
            .order('position'),
          supabase.from('meeting_agenda_votes').select('*').eq('meeting_id', meetingId),
          supabase
            .from('units')
            .select('id, type, number, building_ideal_share_percent, group:group_id(name, code)')
            .eq('archived', false),
          supabase.from('user_unit_links').select('user_id, unit_id'),
          supabase.from('users').select('id, email'),
        ])
        if (cancelled) return
        if (m.error) throw m.error
        if (att.error) throw att.error
        if (ai.error) throw ai.error
        if (av.error) throw av.error
        if (u.error) throw u.error
        if (l.error) throw l.error
        if (usrs.error) throw usrs.error
        if (!m.data) {
          setError('Събранието не е намерено.')
          setLoading(false)
          return
        }
        setMeeting(m.data as MeetingRow)
        setAttendees((att.data ?? []) as AttendeeRow[])
        setAgendaItems((ai.data ?? []) as AgendaItemRow[])
        setAgendaVotes((av.data ?? []) as AgendaVoteRow[])
        setUnits((u.data ?? []) as UnitRow[])
        setLinks((l.data ?? []) as LinkRow[])
        const map = new Map<string, string>()
        for (const row of (usrs.data ?? []) as AppUser[]) {
          if (row.email) map.set(row.id, row.email)
        }
        setEmailByUserId(map)
        setLoading(false)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Грешка при зареждане')
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [meetingId])

  // Auto-print when ready (with 250ms за rendering на шрифтове).
  useEffect(() => {
    if (loading || error || !meeting) return
    const t = setTimeout(() => {
      try {
        window.print()
      } catch {
        /* ignore */
      }
    }, 250)
    return () => clearTimeout(t)
  }, [loading, error, meeting])

  const shareByUnitId = useMemo(() => {
    const m = new Map<string, number | null | undefined>()
    for (const u of units) m.set(u.id, parseIdealShare(u.building_ideal_share_percent))
    return m
  }, [units])

  const attendeeUnitIds = useMemo(() => new Set(attendees.map((a) => a.unit_id)), [attendees])

  const sortedAttendeeUnits = useMemo(() => {
    const set = attendeeUnitIds
    return sortUnitsApartmentFirst(units.filter((u) => set.has(u.id)))
  }, [units, attendeeUnitIds])

  const ownerLabelsByUnitId = useMemo(() => {
    const m = new Map<string, string>()
    const ownersByUnit = new Map<string, string[]>()
    for (const l of links) {
      const arr = ownersByUnit.get(l.unit_id) ?? []
      if (!arr.includes(l.user_id)) arr.push(l.user_id)
      ownersByUnit.set(l.unit_id, arr)
    }
    for (const u of sortedAttendeeUnits) {
      const owners = ownersByUnit.get(u.id) ?? []
      const labels = owners
        .map((uid) => emailByUserId.get(uid)?.trim() || `Потребител ${uid.slice(0, 8)}…`)
      m.set(u.id, labels.length > 0 ? labels.join(', ') : '—')
    }
    return m
  }, [sortedAttendeeUnits, links, emailByUserId])

  const totalSharePercent = useMemo(() => {
    let s = 0
    for (const u of sortedAttendeeUnits) {
      s += parseIdealShare(u.building_ideal_share_percent) ?? 0
    }
    return s
  }, [sortedAttendeeUnits])

  const attendeeNameByUnitId = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of attendees) {
      const n = (a.attendee_name ?? '').trim()
      if (n) m.set(a.unit_id, n)
    }
    return m
  }, [attendees])

  const quorum: QuorumEvaluation | null = useMemo(() => {
    if (!meeting) return null
    const started = new Date(meeting.convening_started_at)
    return evaluateQuorum(started, started, attendeeUnitIds, shareByUnitId, links)
  }, [meeting, attendeeUnitIds, shareByUnitId, links])

  if (loading) return <div className="meeting-print-loading">Зареждане…</div>
  if (error) return <div className="meeting-print-loading">Грешка: {error}</div>
  if (!meeting) return <div className="meeting-print-loading">Не е намерено събрание.</div>

  const startedAt = new Date(meeting.convening_started_at)

  return (
    <div className="meeting-print">
      <div className="meeting-print-actions">
        <button type="button" onClick={() => window.print()}>Печат / Запис в PDF</button>
        <button type="button" onClick={() => window.close()}>Затвори</button>
      </div>

      <header className="meeting-print-header">
        <div className="meeting-print-eyebrow">Протокол от общо събрание</div>
        <h1>{meeting.title?.trim() || 'Събрание'}</h1>
        <div className="meeting-print-meta-grid">
          <div>
            <span>Дата на провеждане:</span>
            <strong>{format(startedAt, 'dd.MM.yyyy HH:mm', { locale: bg })}</strong>
          </div>
          <div>
            <span>Статус:</span>
            <strong>{STATUS_LABEL[meeting.status]}</strong>
          </div>
          <div>
            <span>Покана публикувана на:</span>
            <strong>
              {meeting.convening_notice_posted_at
                ? format(new Date(meeting.convening_notice_posted_at), 'dd.MM.yyyy', { locale: bg })
                : '—'}
            </strong>
          </div>
          {quorum ? (
            <>
              <div>
                <span>Кворум:</span>
                <strong>{quorum.quorumMet ? 'Има се' : 'Няма се'}</strong>
              </div>
              <div>
                <span>Представени ид. части:</span>
                <strong>{quorum.representedPercent.toFixed(2)}%</strong>
              </div>
              <div>
                <span>Праг:</span>
                <strong>
                  {quorum.thresholdPercent}% ({PHASE_LABEL[quorum.phase]})
                </strong>
              </div>
            </>
          ) : null}
        </div>
      </header>

      <section className="meeting-print-section">
        <h2>Присъстващи собственици ({sortedAttendeeUnits.length} обекта · {totalSharePercent.toFixed(4)}%)</h2>
        {sortedAttendeeUnits.length === 0 ? (
          <p>Няма маркирани присъстващи обекти.</p>
        ) : (
          <table className="meeting-print-table">
            <thead>
              <tr>
                <th>Обект</th>
                <th>Собственик</th>
                <th className="meeting-print-num">Ид. ч. (%)</th>
                <th>Представляван от</th>
              </tr>
            </thead>
            <tbody>
              {sortedAttendeeUnits.map((u) => {
                const pct = parseIdealShare(u.building_ideal_share_percent)
                return (
                  <tr key={u.id}>
                    <td>
                      {u.group?.name ? `${u.group.name} ` : ''}
                      №{formatUnitNumberDisplay(u.number)}
                    </td>
                    <td>{ownerLabelsByUnitId.get(u.id) ?? '—'}</td>
                    <td className="meeting-print-num">{pct != null ? pct.toFixed(4) : '—'}</td>
                    <td>{attendeeNameByUnitId.get(u.id) ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="meeting-print-section">
        <h2>Дневен ред и резултати от гласуванията</h2>
        {agendaItems.length === 0 ? (
          <p>Няма точки в дневния ред.</p>
        ) : (
          <ol className="meeting-print-agenda">
            {agendaItems.map((item, idx) => {
              const t = aggregateAgendaVotesForItem(
                item.id,
                agendaVotes,
                attendeeUnitIds,
                links,
                shareByUnitId
              )
              const eligible = t.eligibleShareTotal
              const pct = (s: number) => (eligible > 0 ? (s / eligible) * 100 : 0)
              const votedShare = t.forShare + t.againstShare + t.abstainShare
              return (
                <li key={item.id} className="meeting-print-agenda-item">
                  <h3>
                    {idx + 1}. {item.title}
                  </h3>
                  {item.description?.trim() ? (
                    <p className="meeting-print-agenda-desc">{item.description}</p>
                  ) : null}
                  <div className="meeting-print-agenda-totals">
                    <span>За: <strong>{pct(t.forShare).toFixed(2)}%</strong> ({t.forCount} собств.)</span>
                    <span>Против: <strong>{pct(t.againstShare).toFixed(2)}%</strong> ({t.againstCount})</span>
                    <span>Въздържал се: <strong>{pct(t.abstainShare).toFixed(2)}%</strong> ({t.abstainCount})</span>
                    <span>Гласували: <strong>{pct(votedShare).toFixed(2)}%</strong> от присъстващи</span>
                  </div>
                  {item.voting_status === 'closed' ? (
                    <div
                      className={`meeting-print-decision ${t.passed ? 'is-passed' : 'is-rejected'}`}
                    >
                      {t.passed ? 'РЕШЕНИЕ: ПРИЕТО' : 'РЕШЕНИЕ: ОТХВЪРЛЕНО'}
                      {' '}({t.forPercentOfEligible.toFixed(2)}% „за“ от всички присъстващи ид. части,
                      изискуем праг &gt;{t.requiredPercent}%)
                    </div>
                  ) : (
                    <div className="meeting-print-decision is-pending">
                      Точката не е приключена.
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {meeting.notes?.trim() ? (
        <section className="meeting-print-section">
          <h2>Протокол</h2>
          <div className="meeting-print-notes">{meeting.notes}</div>
        </section>
      ) : null}

      <section className="meeting-print-signatures">
        <div className="meeting-print-signature">
          <div className="meeting-print-signature-line" />
          <div>Председател на събранието</div>
        </div>
        <div className="meeting-print-signature">
          <div className="meeting-print-signature-line" />
          <div>Протоколчик</div>
        </div>
      </section>
    </div>
  )
}
