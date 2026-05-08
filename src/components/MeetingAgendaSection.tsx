import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Select, { type MultiValue, type StylesConfig } from 'react-select'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from '../lib/supabase'
import {
  aggregateAgendaVotesForItem,
  DECISION_REQUIRED_PERCENT,
  eligibleOwnerIds,
  type AgendaVoteRow,
  type VoteChoice,
} from '../lib/meetingVoteAggregate'
import { CheckCircle2, ChevronDown, ChevronUp, GripVertical, Plus, Trash2, Vote, XCircle } from 'lucide-react'
import { useConfirm } from './ConfirmDialog'
import { AGENDA_TEMPLATES } from '../lib/meetingAgendaTemplates'
import './MeetingAgendaSection.css'

/**
 * Sortable wrapper за един `<li>` агенда-item. Подава drag handle (като ReactNode) на render-prop
 * така че item-а сам да реши къде да го разположи в шапката си.
 */
function SortableAgendaLi({
  id,
  disabled,
  className,
  children,
}: {
  id: string
  disabled: boolean
  className?: string
  children: (dragHandle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 5 : undefined,
  }
  const handle = (
    <button
      type="button"
      className="meeting-agenda-drag-handle"
      title="Влачи за пренареждане"
      aria-label="Премести точката чрез влачене"
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} aria-hidden />
    </button>
  )
  return (
    <li ref={setNodeRef} style={style} className={className}>
      {children(handle)}
    </li>
  )
}

type OwnerOption = { value: string; label: string }

/** Стилове в духа на Mobiscroll-подобни multiselect (react-select). */
const ownerMultiStyles: StylesConfig<OwnerOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 42,
    borderRadius: '0.5rem',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--surface)',
    boxShadow: state.isFocused ? '0 0 0 1px var(--primary)' : base.boxShadow,
  }),
  menu: (base) => ({
    ...base,
    borderRadius: '0.5rem',
    overflow: 'hidden',
    boxShadow: 'var(--shadow)',
    border: '1px solid var(--border)',
  }),
  menuPortal: (base) => ({ ...base, zIndex: 10001 }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderRadius: '0.35rem',
  }),
  multiValueLabel: (base) => ({
    ...base,
    fontSize: '0.8125rem',
    color: 'var(--text)',
  }),
  multiValueRemove: (base) => ({
    ...base,
    ':hover': {
      backgroundColor: 'rgba(59, 130, 246, 0.22)',
      color: 'var(--text)',
    },
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.875rem',
    cursor: 'pointer',
    backgroundColor: state.isSelected
      ? 'rgba(59, 130, 246, 0.18)'
      : state.isFocused
        ? 'rgba(0, 0, 0, 0.05)'
        : 'transparent',
    ':active': { ...base, backgroundColor: 'rgba(59, 130, 246, 0.22)' },
  }),
  placeholder: (base) => ({ ...base, color: 'var(--text-light)', fontSize: '0.875rem' }),
  input: (base) => ({ ...base, fontSize: '0.875rem', color: 'var(--text)' }),
  singleValue: (base) => ({ ...base, fontSize: '0.875rem' }),
}

export type AgendaVotingStatus = 'open' | 'closed'

export type AgendaItemRow = {
  id: string
  meeting_id: string
  sort_order: number
  title: string
  description: string | null
  voting_status?: AgendaVotingStatus
}

type LinkRow = { user_id: string; unit_id: string }

export type AgendaAppUser = { id: string; email: string }

type Props = {
  meetingId: string
  userId: string | undefined
  edit: boolean
  attendeeUnitIds: Set<string>
  links: LinkRow[]
  agendaItems: AgendaItemRow[]
  votes: AgendaVoteRow[]
  shareByUnitId: Map<string, number | null | undefined>
  appUsers: AgendaAppUser[]
  onRefresh: () => Promise<void>
}

const VOTE_LABELS: Record<VoteChoice, string> = {
  for: 'За',
  against: 'Против',
  abstain: 'Въздържал се',
}

export default function MeetingAgendaSection({
  meetingId,
  userId,
  edit,
  attendeeUnitIds,
  links,
  agendaItems,
  votes,
  shareByUnitId,
  appUsers,
  onRefresh,
}: Props) {
  const confirmAction = useConfirm()
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [voteBusy, setVoteBusy] = useState<string | null>(null)
  /** Избрани собственици за ръчен запис по agenda_item_id (множествен избор) */
  const [manualTargetsByItem, setManualTargetsByItem] = useState<Record<string, string[]>>({})
  /** Точки със статус „Гласувана“: по подразбиране сгънати; true = разгънато */
  const [closedAgendaExpanded, setClosedAgendaExpanded] = useState<Record<string, boolean>>({})

  const sortedItems = useMemo(
    () =>
      [...agendaItems].sort(
        (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'bg')
      ),
    [agendaItems]
  )

  /** Има поне един присъстващ обект в събранието за този акаунт. */
  const canVote = useMemo(() => {
    if (!userId || attendeeUnitIds.size === 0) return false
    return eligibleOwnerIds(attendeeUnitIds, links).has(userId)
  }, [userId, attendeeUnitIds, links])

  const eligibleUsersSorted = useMemo(() => {
    const ids = eligibleOwnerIds(attendeeUnitIds, links)
    const arr = [...ids].map((id) => {
      const u = appUsers.find((x) => x.id === id)
      const email = u?.email?.trim()
      return {
        id,
        label: email || `Потребител ${id.slice(0, 8)}…`,
      }
    })
    arr.sort((a, b) => a.label.localeCompare(b.label, 'bg'))
    return arr
  }, [attendeeUnitIds, links, appUsers])

  const emailByUserId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of appUsers) {
      if (u.email?.trim()) m.set(u.id, u.email.trim())
    }
    return m
  }, [appUsers])

  const ownerSelectOptions: OwnerOption[] = useMemo(
    () => eligibleUsersSorted.map((u) => ({ value: u.id, label: u.label })),
    [eligibleUsersSorted]
  )

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title || !edit) return
    setAdding(true)
    try {
      const maxOrder =
        agendaItems.length === 0 ? 0 : Math.max(...agendaItems.map((i) => i.sort_order), 0)
      const { error } = await supabase.from('meeting_agenda_items').insert({
        meeting_id: meetingId,
        sort_order: maxOrder + 10,
        title,
        description: newDesc.trim() || null,
      })
      if (error) throw error
      setNewTitle('')
      setNewDesc('')
      await onRefresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при добавяне на точка')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!edit) return
    const ok = await confirmAction({
      title: 'Изтриване на точка',
      message: 'Сигурни ли сте, че искате да изтриете тази точка от дневния ред заедно с всички подадени гласове по нея?',
      confirmLabel: 'Изтрий',
      variant: 'danger',
    })
    if (!ok) return
    setBusyId(id)
    try {
      const { error } = await supabase.from('meeting_agenda_items').delete().eq('id', id)
      if (error) throw error
      await onRefresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при изтриване')
    } finally {
      setBusyId(null)
    }
  }

  const setItemStatus = async (itemId: string, voting_status: AgendaVotingStatus) => {
    if (!edit) return
    setBusyId(itemId)
    try {
      const { error } = await supabase
        .from('meeting_agenda_items')
        .update({ voting_status })
        .eq('id', itemId)
      if (error) throw error
      await onRefresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при промяна на статуса')
    } finally {
      setBusyId(null)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (!edit) return
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = sortedItems.findIndex((i) => i.id === active.id)
      const newIndex = sortedItems.findIndex((i) => i.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const newOrder = arrayMove(sortedItems, oldIndex, newIndex)
      setBusyId(active.id as string)
      try {
        const updates = newOrder.map(async (it, idx) => {
          const target = (idx + 1) * 10
          if (it.sort_order === target) return
          const { error } = await supabase
            .from('meeting_agenda_items')
            .update({ sort_order: target })
            .eq('id', it.id)
          if (error) throw error
        })
        await Promise.all(updates)
        await onRefresh()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Грешка при пренареждане на точките')
      } finally {
        setBusyId(null)
      }
    },
    [edit, sortedItems, onRefresh]
  )

  const swapOrder = async (item: AgendaItemRow, direction: -1 | 1) => {
    if (!edit) return
    const idx = sortedItems.findIndex((x) => x.id === item.id)
    const neighborIdx = idx + direction
    if (neighborIdx < 0 || neighborIdx >= sortedItems.length) return
    const a = sortedItems[idx]
    const b = sortedItems[neighborIdx]
    setBusyId(item.id)
    try {
      const { error: e1 } = await supabase
        .from('meeting_agenda_items')
        .update({ sort_order: b.sort_order })
        .eq('id', a.id)
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('meeting_agenda_items')
        .update({ sort_order: a.sort_order })
        .eq('id', b.id)
      if (e2) throw e2
      await onRefresh()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при пренареждане')
    } finally {
      setBusyId(null)
    }
  }

  const castVote = useCallback(
    async (agendaItemId: string, vote: VoteChoice) => {
      if (!userId) return
      setVoteBusy(agendaItemId)
      try {
        const { error } = await supabase.rpc('meeting_agenda_vote_upsert_self', {
          p_agenda_item_id: agendaItemId,
          p_vote: vote,
        })
        if (error) throw error
        await onRefresh()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Грешка при гласуване')
      } finally {
        setVoteBusy(null)
      }
    },
    [userId, onRefresh]
  )

  const castManualVote = useCallback(
    async (agendaItemId: string, vote: VoteChoice) => {
      if (!edit) return
      const targets = manualTargetsByItem[agendaItemId] ?? []
      if (targets.length === 0) {
        alert('Маркирайте поне един собственик в списъка.')
        return
      }
      setVoteBusy(agendaItemId)
      const failures: string[] = []
      try {
        for (const targetUserId of targets) {
          const { error } = await supabase.rpc('meeting_agenda_vote_upsert_for_user', {
            p_agenda_item_id: agendaItemId,
            p_vote: vote,
            p_target_user_id: targetUserId,
          })
          if (error) {
            const label =
              appUsers.find((u) => u.id === targetUserId)?.email?.trim() ??
              `Потребител ${targetUserId.slice(0, 8)}…`
            failures.push(`${label}: ${error.message}`)
          }
        }
        if (failures.length > 0) {
          alert(
            failures.length === targets.length
              ? failures.join('\n')
              : `Частичен запис. Грешки:\n${failures.join('\n')}`
          )
        }
        await onRefresh()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Грешка при запис на глас')
      } finally {
        setVoteBusy(null)
      }
    },
    [edit, manualTargetsByItem, onRefresh, appUsers]
  )

  const removeVoteForUser = useCallback(
    async (agendaItemId: string, targetUserId: string) => {
      if (!edit) return
      const ok = await confirmAction({
        title: 'Премахване на глас',
        message: 'Сигурни ли сте, че искате да премахнете този записан глас?',
        confirmLabel: 'Премахни',
        variant: 'danger',
      })
      if (!ok) return
      setVoteBusy(agendaItemId)
      try {
        const { error } = await supabase
          .from('meeting_agenda_votes')
          .delete()
          .eq('agenda_item_id', agendaItemId)
          .eq('user_id', targetUserId)
        if (error) throw error
        await onRefresh()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Грешка при премахване на глас')
      } finally {
        setVoteBusy(null)
      }
    },
    [edit, onRefresh, confirmAction]
  )

  const noAttendees = attendeeUnitIds.size === 0

  return (
    <div className="meeting-agenda card-like">
      <h2 className="meeting-agenda-title">
        <Vote size={22} className="meeting-agenda-title-icon" aria-hidden />
        Точки за гласуване
      </h2>
      <p className="meeting-agenda-lead">
        Точките могат да се подготвят предварително. Статусът <strong>Отворена за гласуване</strong> позволява
        гласуване; след като администраторът маркира точката като <strong>Гласувана</strong>, гласове вече не се
        приемат. <strong>Един глас на собственик</strong> по точка; тежестта е сумата от ид. частите на вашите
        обекти, маркирани като присъстващи. Администраторът може да записва глас от името на собственик без
        приложение (на място).
      </p>

      {edit && (
        <form className="meeting-agenda-add" onSubmit={(e) => void handleAdd(e)}>
          <div className="meeting-agenda-add-grid">
            <div className="form-group">
              <label htmlFor="agenda-new-template">Шаблон (по желание)</label>
              <select
                id="agenda-new-template"
                value=""
                onChange={(e) => {
                  const tmpl = AGENDA_TEMPLATES.find((t) => t.id === e.target.value)
                  if (!tmpl) return
                  setNewTitle(tmpl.title)
                  setNewDesc(tmpl.description)
                  e.target.value = ''
                }}
              >
                <option value="">— избери шаблон, за да попълниш полетата…</option>
                {AGENDA_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="agenda-new-title">Заглавие на точката *</label>
              <input
                id="agenda-new-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Напр. Избор на домоуправител"
                required
              />
            </div>
            <div className="form-group meeting-agenda-add-desc">
              <label htmlFor="agenda-new-desc">Пояснение (по желание)</label>
              <textarea
                id="agenda-new-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Кратко описание за присъстващите…"
                rows={2}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={adding}>
            <Plus size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {adding ? 'Добавяне…' : 'Добави точка'}
          </button>
        </form>
      )}

      {sortedItems.length === 0 ? (
        <p className="meetings-empty meeting-agenda-empty">Все още няма точки за гласуване.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext
            items={sortedItems.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
        <ul className="meeting-agenda-list">
          {sortedItems.map((item, index) => {
            const status: AgendaVotingStatus = item.voting_status ?? 'open'
            const votingOpen = status === 'open'
            const isClosed = status === 'closed'
            const itemBodyExpanded = !isClosed || (closedAgendaExpanded[item.id] ?? false)
            const totals = aggregateAgendaVotesForItem(
              item.id,
              votes,
              attendeeUnitIds,
              links,
              shareByUnitId
            )
            const showVoting = !noAttendees && canVote && votingOpen
            const currentVote = votes.find(
              (v) => v.agenda_item_id === item.id && v.user_id === userId
            )?.vote

            return (
              <SortableAgendaLi
                key={item.id}
                id={item.id}
                disabled={!edit || busyId !== null}
                className={`meeting-agenda-item${isClosed && !itemBodyExpanded ? ' meeting-agenda-item--accordion-collapsed' : ''}`}
              >
                {(dragHandle) => (<>
                <div className="meeting-agenda-item-head">
                  {edit ? dragHandle : null}
                  <span className="meeting-agenda-item-num">{index + 1}.</span>
                  {isClosed ? (
                    <button
                      type="button"
                      className="btn-icon meeting-agenda-accordion-toggle"
                      id={`agenda-item-acc-${item.id}`}
                      aria-expanded={itemBodyExpanded}
                      aria-controls={`agenda-item-body-${item.id}`}
                      title={itemBodyExpanded ? 'Сгъни' : 'Разгъни'}
                      onClick={() =>
                        setClosedAgendaExpanded((prev) => ({
                          ...prev,
                          [item.id]: !(prev[item.id] ?? false),
                        }))
                      }
                    >
                      <ChevronDown
                        size={20}
                        className={`meeting-agenda-accordion-chevron${itemBodyExpanded ? ' is-open' : ''}`}
                        aria-hidden
                      />
                    </button>
                  ) : null}
                  <span className="meeting-agenda-item-title">{item.title}</span>
                  {!edit ? (
                    <span
                      className={`meeting-agenda-status meeting-agenda-status--${status}`}
                      title="Статус на гласуването по точката"
                    >
                      {status === 'open' ? 'Отворена за гласуване' : 'Гласувана'}
                    </span>
                  ) : null}
                  {isClosed && totals.eligibleShareTotal > 0 ? (
                    <span
                      className={`meeting-agenda-decision meeting-agenda-decision--${totals.passed ? 'passed' : 'rejected'}`}
                      title={`За: ${totals.forPercentOfEligible.toFixed(2)}% от присъстващите ид. части · Праг: над ${DECISION_REQUIRED_PERCENT}%`}
                    >
                      {totals.passed ? (
                        <CheckCircle2 size={14} aria-hidden />
                      ) : (
                        <XCircle size={14} aria-hidden />
                      )}
                      {totals.passed ? 'Прието' : 'Отхвърлено'}
                    </span>
                  ) : null}
                  {edit && (
                    <span className="meeting-agenda-item-actions">
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={busyId !== null || index === 0}
                        onClick={() => void swapOrder(item, -1)}
                        title="Нагоре"
                        aria-label="Премести нагоре"
                      >
                        <ChevronUp size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        disabled={busyId !== null || index === sortedItems.length - 1}
                        onClick={() => void swapOrder(item, 1)}
                        title="Надолу"
                        aria-label="Премести надолу"
                      >
                        <ChevronDown size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon meeting-agenda-delete"
                        disabled={busyId !== null}
                        onClick={() => void handleDelete(item.id)}
                        title="Изтрий точката"
                        aria-label="Изтрий точката"
                      >
                        <Trash2 size={18} />
                      </button>
                      <select
                        className={`meeting-agenda-status-select meeting-agenda-status-select--${status}`}
                        value={status}
                        disabled={busyId !== null}
                        onChange={(e) =>
                          void setItemStatus(item.id, e.target.value as AgendaVotingStatus)
                        }
                        aria-label="Статус на точката"
                        title="Статус на гласуването по точката"
                      >
                        <option value="open">Отворена за гласуване</option>
                        <option value="closed">Гласувана</option>
                      </select>
                    </span>
                  )}
                </div>
                {isClosed && !itemBodyExpanded ? (
                  <p className="meeting-agenda-item-collapsed-summary">
                    <strong>Резултат:</strong>{' '}
                    {totals.eligibleShareTotal > 0 ? (
                      <span
                        className={`meeting-agenda-item-collapsed-decision meeting-agenda-item-collapsed-decision--${totals.passed ? 'passed' : 'rejected'}`}
                      >
                        {totals.passed ? 'Прието' : 'Отхвърлено'} ({totals.forPercentOfEligible.toFixed(2)}% за){' '}
                      </span>
                    ) : null}
                    · За {totals.forCount} соб. · {totals.forShare.toFixed(2)}% ид. части · Против{' '}
                    {totals.againstCount} · Въздържали се {totals.abstainCount}
                    <span className="meeting-agenda-item-collapsed-hint"> Разгънете за подробности.</span>
                  </p>
                ) : null}
                {itemBodyExpanded ? (
                  <div
                    className="meeting-agenda-item-expanded"
                    {...(isClosed
                      ? {
                          id: `agenda-item-body-${item.id}`,
                          role: 'region' as const,
                          'aria-labelledby': `agenda-item-acc-${item.id}`,
                        }
                      : {})}
                  >
                    {item.description?.trim() ? (
                      <p className="meeting-agenda-item-desc">{item.description.trim()}</p>
                    ) : null}

                    {noAttendees ? (
                  <p className="meeting-agenda-hint meeting-agenda-hint--warn">
                    Добавете присъстващи обекти по-долу, за да може гласуването да е активно.
                  </p>
                ) : showVoting ? (
                  <div className="meeting-agenda-vote-block">
                    <div className="meeting-agenda-vote-label">Вашият глас:</div>
                    <div className="meeting-agenda-vote-row meeting-agenda-vote-row--single">
                      <div className="meeting-agenda-vote-btns">
                        {(['for', 'against', 'abstain'] as const).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            className={`btn-secondary btn-small meeting-agenda-vote-btn${currentVote === ch ? ' is-selected' : ''}`}
                            disabled={voteBusy !== null}
                            onClick={() => void castVote(item.id, ch)}
                          >
                            {voteBusy === item.id ? '…' : VOTE_LABELS[ch]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : !noAttendees && canVote && !votingOpen ? (
                  <p className="meeting-agenda-hint meeting-agenda-hint--closed">
                    Гласуването по тази точка е приключило.
                    {currentVote ? (
                      <>
                        {' '}
                        Вашият подаден глас: <strong>{VOTE_LABELS[currentVote]}</strong>.
                      </>
                    ) : (
                      <> Не сте подали глас преди затварянето.</>
                    )}
                  </p>
                ) : (
                  <p className="meeting-agenda-hint">
                    Нямате присъстващ обект в това събрание — не можете да гласувате.
                  </p>
                )}

                {edit && !noAttendees && votingOpen && eligibleUsersSorted.length > 0 ? (
                  <div className="meeting-agenda-manual">
                    <div className="meeting-agenda-vote-label">Ръчен запис на глас</div>
                    <p className="meeting-agenda-manual-hint">
                      Изберете един или повече профила от полето (с търсене); после натиснете глас — един и същ
                      избор се записва за всички избрани.
                    </p>
                    <div className="meeting-agenda-manual-row">
                      <div className="meeting-agenda-manual-pick-wrap">
                        <div className="meeting-agenda-manual-toolbar">
                          <button
                            type="button"
                            className="meeting-agenda-manual-linkbtn"
                            disabled={voteBusy !== null}
                            onClick={() =>
                              setManualTargetsByItem((prev) => ({
                                ...prev,
                                [item.id]: eligibleUsersSorted.map((u) => u.id),
                              }))
                            }
                          >
                            Всички
                          </button>
                          <button
                            type="button"
                            className="meeting-agenda-manual-linkbtn"
                            disabled={voteBusy !== null}
                            onClick={() =>
                              setManualTargetsByItem((prev) => ({ ...prev, [item.id]: [] }))
                            }
                          >
                            Никой
                          </button>
                          <span className="meeting-agenda-manual-count">
                            Избрани: {(manualTargetsByItem[item.id] ?? []).length} от{' '}
                            {eligibleUsersSorted.length}
                          </span>
                        </div>
                        <Select<OwnerOption, true>
                          inputId={`agenda-manual-users-${item.id}`}
                          instanceId={`owner-ms-${item.id}`}
                          classNamePrefix="meeting-agenda-rs"
                          isMulti
                          options={ownerSelectOptions}
                          value={ownerSelectOptions.filter((o) =>
                            (manualTargetsByItem[item.id] ?? []).includes(o.value)
                          )}
                          onChange={(newValue) => {
                            const opts = newValue as MultiValue<OwnerOption>
                            setManualTargetsByItem((prev) => ({
                              ...prev,
                              [item.id]: opts ? opts.map((o) => o.value) : [],
                            }))
                          }}
                          placeholder="Изберете собственици…"
                          noOptionsMessage={() => 'Няма намерени'}
                          closeMenuOnSelect={false}
                          blurInputOnSelect={false}
                          hideSelectedOptions={false}
                          isClearable
                          isDisabled={voteBusy !== null}
                          styles={ownerMultiStyles}
                          menuPortalTarget={
                            typeof document !== 'undefined' ? document.body : null
                          }
                          menuPosition="fixed"
                          aria-label="Собственици за ръчен глас по тази точка"
                        />
                      </div>
                      <div className="meeting-agenda-vote-btns meeting-agenda-manual-btns">
                        {(['for', 'against', 'abstain'] as const).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            className="btn-secondary btn-small meeting-agenda-vote-btn"
                            disabled={voteBusy !== null}
                            onClick={() => void castManualVote(item.id, ch)}
                          >
                            {voteBusy === item.id ? '…' : VOTE_LABELS[ch]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {edit ? (
                  <div className="meeting-agenda-admin-votes">
                    <div className="meeting-agenda-vote-label">Подадени гласове по собственици</div>
                    {votes.filter((v) => v.agenda_item_id === item.id).length === 0 ? (
                      <p className="meeting-agenda-admin-votes-empty">Все още няма записани гласове.</p>
                    ) : (
                      <ul className="meeting-agenda-admin-votes-list">
                        {votes
                          .filter((v) => v.agenda_item_id === item.id)
                          .slice()
                          .sort((a, b) => {
                            const la = emailByUserId.get(a.user_id) ?? a.user_id
                            const lb = emailByUserId.get(b.user_id) ?? b.user_id
                            return la.localeCompare(lb, 'bg')
                          })
                          .map((v) => (
                            <li key={v.user_id} className="meeting-agenda-admin-votes-item">
                              <span className="meeting-agenda-admin-votes-who">
                                {emailByUserId.get(v.user_id) ??
                                  `Потребител ${v.user_id.slice(0, 8)}…`}
                              </span>
                              <span className="meeting-agenda-admin-votes-how">{VOTE_LABELS[v.vote]}</span>
                              <button
                                type="button"
                                className="btn-secondary btn-small meeting-agenda-admin-votes-remove"
                                disabled={voteBusy !== null}
                                onClick={() => void removeVoteForUser(item.id, v.user_id)}
                              >
                                Премахни
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                    <div className="meeting-agenda-results">
                      <div className="meeting-agenda-results-title">Резултат</div>
                      <div className="meeting-agenda-results-grid">
                        <span>За:</span>
                        <strong>
                          {totals.forCount} собственика · {totals.forShare.toFixed(4)}% ид. части
                        </strong>
                        <span>Против:</span>
                        <strong>
                          {totals.againstCount} собственика · {totals.againstShare.toFixed(4)}% ид. части
                        </strong>
                        <span>Въздържали се:</span>
                        <strong>
                          {totals.abstainCount} собственика · {totals.abstainShare.toFixed(4)}% ид. части
                        </strong>
                        <span className="meeting-agenda-results-meta">Присъстващи обекти:</span>
                        <span className="meeting-agenda-results-meta">
                          {totals.eligibleUnits} · {totals.eligibleShareTotal.toFixed(4)}% ид. части общо
                        </span>
                        {totals.notVotedOwners > 0 ? (
                          <>
                            <span className="meeting-agenda-results-warn">Без подаден глас:</span>
                            <span className="meeting-agenda-results-warn">
                              {totals.notVotedOwners} собственика
                            </span>
                          </>
                        ) : totals.eligibleOwners > 0 ? (
                          <>
                            <span className="meeting-agenda-results-ok">
                              Всички собственици с право на глас са гласували.
                            </span>
                            <span />
                          </>
                        ) : null}
                        {isClosed && totals.eligibleShareTotal > 0 ? (
                          <>
                            <span>Решение:</span>
                            <strong
                              className={`meeting-agenda-results-decision meeting-agenda-results-decision--${totals.passed ? 'passed' : 'rejected'}`}
                            >
                              {totals.passed ? 'Прието' : 'Отхвърлено'} —{' '}
                              {totals.forPercentOfEligible.toFixed(2)}% „за“ от присъстващите ид. части
                              {' '}(праг над {DECISION_REQUIRED_PERCENT}%)
                            </strong>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
                </>)}
              </SortableAgendaLi>
            )
          })}
        </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
