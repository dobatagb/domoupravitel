import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  Dices,
  Plus,
  Trash2,
  Shuffle,
  RotateCcw,
  Users,
  Info,
  ChevronUp,
  ChevronDown,
  Megaphone,
  RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import './ParkingLottery.css'

type LotteryRow = {
  id: string
  year: number
  /** 1 или 2 — кое теглене за същата календарна година */
  round: number
  title: string | null
  created_at: string
  drawn_at: string | null
}

/** PostgREST `.or()`: всички завършени томболи с (year, round) лексикографски преди текущата */
function filterPreviousLotteries(year: number, round: number): string {
  return `year.lt.${year},and(year.eq.${year},round.lt.${round})`
}

type ParticipantRow = {
  id: string
  lottery_id: string
  user_id: string
  email: string
}

type ParkingUnitRow = {
  id: string
  number: string
  group?: { name: string; code: string } | null
}

type ResultRow = {
  id: string
  lottery_id: string
  unit_id: string
  parking_label: string
  user_id: string
  email: string
  sort_order: number
  is_repeat: boolean
}

type AppUser = { id: string; email: string }

function announcementTitleForLottery(lottery: LotteryRow): string {
  if (lottery.title?.trim()) {
    return `${lottery.title.trim()} — резултат`
  }
  return `Томбола паркоместа ${lottery.year} (тегл. ${lottery.round ?? 1}) — резултат`
}

function buildLotteryAnnouncementBody(lottery: LotteryRow, rows: ResultRow[]): string {
  const header =
    lottery.title?.trim() ||
    `Томбола за паркоместа — ${lottery.year} г., теглене ${lottery.round ?? 1}`
  const lines = [
    header,
    '',
    'Резултат от тегленето:',
    '',
    ...rows.map((r) => `${r.sort_order}. ${r.parking_label} — ${r.email}`),
  ]
  return lines.join('\n')
}

function parkingLabel(u: Pick<ParkingUnitRow, 'number' | 'group'>): string {
  const g = u.group?.name?.trim()
  const n = String(u.number ?? '').trim()
  return g ? `${g} ${n}` : `Паркомясто ${n}`
}

function sortParkingUnits(units: ParkingUnitRow[]): ParkingUnitRow[] {
  return [...units].sort((a, b) => {
    const na = parseInt(String(a.number), 10)
    const nb = parseInt(String(b.number), 10)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return String(a.number).localeCompare(String(b.number), 'bg', { numeric: true })
  })
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0] % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function ParkingLottery() {
  const { canEdit, user } = useAuth()
  const edit = canEdit()

  const [lotteries, setLotteries] = useState<LotteryRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [results, setResults] = useState<ResultRow[]>([])
  const [allUsers, setAllUsers] = useState<AppUser[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [prevLottery, setPrevLottery] = useState<LotteryRow | null>(null)
  const [prevParticipants, setPrevParticipants] = useState<ParticipantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [parkingUnits, setParkingUnits] = useState<ParkingUnitRow[]>([])
  const [reorderSaving, setReorderSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [applyingLinks, setApplyingLinks] = useState(false)

  const [newYear, setNewYear] = useState(() => new Date().getFullYear())
  const [newRound, setNewRound] = useState<1 | 2>(1)
  const [newTitle, setNewTitle] = useState('')
  const [initDone, setInitDone] = useState(false)

  const selected = useMemo(
    () => lotteries.find((l) => l.id === selectedId) ?? null,
    [lotteries, selectedId]
  )

  const resultsSorted = useMemo(
    () => [...results].sort((a, b) => a.sort_order - b.sort_order),
    [results]
  )

  const loadParkingUnits = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('units')
      .select('id, number, group:group_id(name, code)')
    if (e) throw e
    const rows = ((data as unknown as ParkingUnitRow[]) || []).filter((u) => u.group?.code === 'parking')
    setParkingUnits(sortParkingUnits(rows))
  }, [])

  const loadLotteries = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('parking_lotteries')
      .select('*')
      .order('year', { ascending: false })
      .order('round', { ascending: false })
    if (e) throw e
    const list = (data as LotteryRow[]) || []
    setLotteries(list)
    return list
  }, [])

  const loadUsers = useCallback(async () => {
    if (!edit) return
    const { data, error: e } = await supabase.from('users').select('id, email').order('email')
    if (e) throw e
    setAllUsers((data as AppUser[]) || [])
  }, [edit])

  const loadDetail = useCallback(async (lotteryId: string, year: number, round: number) => {
    const [pRes, rRes, prevDrawn] = await Promise.all([
      supabase.from('parking_lottery_participants').select('*').eq('lottery_id', lotteryId),
      supabase
        .from('parking_lottery_results')
        .select('*')
        .eq('lottery_id', lotteryId)
        .order('sort_order'),
      supabase
        .from('parking_lotteries')
        .select('*')
        .not('drawn_at', 'is', null)
        .or(filterPreviousLotteries(year, round))
        .order('year', { ascending: false })
        .order('round', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (pRes.error) throw pRes.error
    if (rRes.error) throw rRes.error
    if (prevDrawn.error) throw prevDrawn.error

    const plist = (pRes.data as ParticipantRow[]) || []
    setParticipants(plist)
    setSelectedUserIds(new Set(plist.map((p) => p.user_id)))
    setResults((rRes.data as ResultRow[]) || [])

    const prev = prevDrawn.data as LotteryRow | null
    setPrevLottery(prev)
    if (prev?.id) {
      const prevP = await supabase.from('parking_lottery_participants').select('*').eq('lottery_id', prev.id)
      if (prevP.error) throw prevP.error
      setPrevParticipants((prevP.data as ParticipantRow[]) || [])
    } else {
      setPrevParticipants([])
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setError(null)
      setLoading(true)
      try {
        const list = await loadLotteries()
        await loadUsers()
        await loadParkingUnits()
        if (list.length) {
          setSelectedId((prev) => prev ?? list[0].id)
        }
      } catch (err: unknown) {
        console.error(err)
        setError(err instanceof Error ? err.message : 'Грешка при зареждане')
      } finally {
        setLoading(false)
        setInitDone(true)
      }
    })()
  }, [loadLotteries, loadUsers, loadParkingUnits])

  useEffect(() => {
    if (!initDone || !selectedId) return
    const row = lotteries.find((l) => l.id === selectedId)
    if (!row) return
    void (async () => {
      try {
        await loadDetail(selectedId, row.year, row.round ?? 1)
      } catch (e) {
        console.error(e)
      }
    })()
  }, [initDone, selectedId, lotteries, loadDetail])

  const handleCreateLottery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!edit) return
    setSaving(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('parking_lotteries')
        .insert({
          year: newYear,
          round: newRound,
          title: newTitle.trim() || null,
        })
        .select('*')
        .single()
      if (err) throw err
      const row = data as LotteryRow
      await loadLotteries()
      setSelectedId(row.id)
      setNewTitle('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Неуспешно създаване'
      setError(
        msg.includes('duplicate')
          ? 'Вече има томбола за тази година и избраното теглене (1 или 2).'
          : msg
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLottery = async (id: string) => {
    if (!edit) return
    if (!confirm('Да се изтрие ли тази томбола заедно с участници и резултати?')) return
    setSaving(true)
    try {
      const { error: err } = await supabase.from('parking_lotteries').delete().eq('id', id)
      if (err) throw err
      const wasSelected = selectedId === id
      const list = await loadLotteries()
      await loadUsers()
      if (wasSelected) {
        setSelectedId(list.length ? list[0].id : null)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при изтриване')
    } finally {
      setSaving(false)
    }
  }

  const saveParticipants = async () => {
    if (!edit || !selectedId || !selected) return
    if (selected.drawn_at) {
      alert('Томболата вече е теглена. Нулирай тегленето, за да променяш участниците.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const rows = allUsers
        .filter((u) => selectedUserIds.has(u.id))
        .map((u) => ({
          lottery_id: selectedId,
          user_id: u.id,
          email: u.email,
        }))
      const { error: delErr } = await supabase.from('parking_lottery_participants').delete().eq('lottery_id', selectedId)
      if (delErr) throw delErr
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('parking_lottery_participants').insert(rows)
        if (insErr) throw insErr
      }
      await loadDetail(selectedId, selected.year, selected.round ?? 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при запис')
    } finally {
      setSaving(false)
    }
  }

  const runDraw = async () => {
    if (!edit || !selectedId || !selected) return
    if (selected.drawn_at) return
    if (participants.length === 0) {
      alert('Няма участници.')
      return
    }
    if (parkingUnits.length === 0) {
      alert('Няма паркоместа в „Обекти“ (група Паркомясто). Добави ги в номенклатурата.')
      return
    }
    if (participants.length < parkingUnits.length) {
      alert(
        `Трябват поне ${parkingUnits.length} участници (по един на всяко от ${parkingUnits.length}-те паркоместа). Сега са избрани ${participants.length}.`
      )
      return
    }
    if (
      !confirm(
        'Ще се разпределят печелившите по всички паркоместа: първо участниците, които не са били в предходната томбола, после останалите (случаен ред във всяка група). Всеки ред в резултата = едно паркомясто + печеливш.'
      )
    )
      return

    setDrawing(true)
    setError(null)
    try {
      const { data: prevRow } = await supabase
        .from('parking_lotteries')
        .select('id')
        .not('drawn_at', 'is', null)
        .or(filterPreviousLotteries(selected.year, selected.round ?? 1))
        .order('year', { ascending: false })
        .order('round', { ascending: false })
        .limit(1)
        .maybeSingle()

      let repeatFromPrev = new Set<string>()
      if (prevRow?.id) {
        const { data: prevParts } = await supabase
          .from('parking_lottery_participants')
          .select('user_id')
          .eq('lottery_id', prevRow.id)
        repeatFromPrev = new Set((prevParts || []).map((r: { user_id: string }) => r.user_id))
      }

      const newPool = participants.filter((p) => !repeatFromPrev.has(p.user_id))
      const repeatPool = participants.filter((p) => repeatFromPrev.has(p.user_id))
      const ordered = [...shuffle(newPool), ...shuffle(repeatPool)]
      const winners = ordered.slice(0, parkingUnits.length)

      const resultRows = parkingUnits.map((unit, i) => {
        const p = winners[i]!
        return {
          lottery_id: selectedId,
          unit_id: unit.id,
          parking_label: parkingLabel(unit),
          user_id: p.user_id,
          email: p.email,
          sort_order: i + 1,
          is_repeat: repeatFromPrev.has(p.user_id),
        }
      })

      const { error: insErr } = await supabase.from('parking_lottery_results').insert(resultRows)
      if (insErr) throw insErr

      const { error: upErr } = await supabase
        .from('parking_lotteries')
        .update({ drawn_at: new Date().toISOString() })
        .eq('id', selectedId)
      if (upErr) throw upErr

      await loadLotteries()
      await loadDetail(selectedId, selected.year, selected.round ?? 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при теглене')
    } finally {
      setDrawing(false)
    }
  }

  const resetDraw = async () => {
    if (!edit || !selectedId || !selected?.drawn_at) return
    if (!confirm('Да се изтрият ли резултатите и да се позволи ново теглене?')) return
    setSaving(true)
    try {
      const { error: d1 } = await supabase.from('parking_lottery_results').delete().eq('lottery_id', selectedId)
      if (d1) throw d1
      const { error: d2 } = await supabase.from('parking_lotteries').update({ drawn_at: null }).eq('id', selectedId)
      if (d2) throw d2
      await loadLotteries()
      await loadDetail(selectedId, selected.year, selected.round ?? 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка')
    } finally {
      setSaving(false)
    }
  }

  const swapWinners = async (indexA: number, indexB: number) => {
    if (!edit || !selectedId || resultsSorted.length < 2) return
    const a = resultsSorted[indexA]
    const b = resultsSorted[indexB]
    if (!a || !b) return
    setReorderSaving(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('swap_parking_lottery_winners', {
        p_id_a: a.id,
        p_id_b: b.id,
      })
      if (rpcErr) throw rpcErr
      if (selected) await loadDetail(selectedId, selected.year, selected.round ?? 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при пренареждане')
    } finally {
      setReorderSaving(false)
    }
  }

  const publishResultsAnnouncement = async () => {
    if (!edit || !selected?.drawn_at || resultsSorted.length === 0) return
    if (!confirm('Да се публикува ли съобщение с резултата при „Съобщения“ за всички потребители?')) return
    setPublishing(true)
    setError(null)
    try {
      const title = announcementTitleForLottery(selected)
      const body = buildLotteryAnnouncementBody(selected, resultsSorted)
      const { error: insErr } = await supabase.from('announcements').insert({
        title,
        body,
        pinned: false,
        created_by: user?.id ?? null,
      })
      if (insErr) throw insErr
      alert('Съобщението е публикувано. Виж раздел „Съобщения“.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при публикуване')
    } finally {
      setPublishing(false)
    }
  }

  const applyParkingLinksFromResults = async () => {
    if (!edit || !selectedId || !selected?.drawn_at || resultsSorted.length === 0) return
    if (
      !confirm(
        'За всяко паркомясто от резултата ще се премахнат старите връзки към него и ще се зададе печелившият като собственик в „Мои обекти“. Продължаваме ли?'
      )
    )
      return
    setApplyingLinks(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('apply_parking_lottery_unit_links', {
        p_lottery_id: selectedId,
      })
      if (rpcErr) throw rpcErr
      alert('Връзките потребител ↔ паркомясто са обновени.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Грешка при обновяване на връзките')
    } finally {
      setApplyingLinks(false)
    }
  }

  const toggleUser = (userId: string) => {
    if (!edit || selected?.drawn_at) return
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  return (
    <div className="parking-lottery-page">
      <div className="page-header">
        <h1>
          <Dices className="parking-lottery-title-icon" size={28} aria-hidden />
          Томбола — паркоместа
        </h1>
        <p className="page-subtitle">
          До две томболи годишно (теглене 1 и 2). Броят печеливши = броят паркоместа в обектите. При теглене участвалите в{' '}
          <strong>предходната завършена</strong> томбола отиват след новите (случаен ред във всяка група). След теглене
          може ръчно да размениш печелившите между паркоместата. Резултатите виждат всички влезли потребители.
        </p>
      </div>

      {error && (
        <div className="parking-lottery-error">
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <p className="parking-lottery-muted">Зареждане…</p>
      ) : (
        <>
          {edit && (
            <form className="parking-lottery-form-card" onSubmit={handleCreateLottery}>
              <h2>Нова томбола</h2>
              <div className="parking-lottery-form-row">
                <label>
                  Година
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={newYear}
                    onChange={(e) => setNewYear(Number(e.target.value))}
                    required
                  />
                </label>
                <label>
                  Теглене
                  <select
                    value={newRound}
                    onChange={(e) => setNewRound(Number(e.target.value) as 1 | 2)}
                    required
                  >
                    <option value={1}>1 (първо за годината)</option>
                    <option value={2}>2 (второ за годината)</option>
                  </select>
                </label>
                <label className="parking-lottery-grow">
                  Заглавие (по избор)
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="напр. Томбола 2026"
                  />
                </label>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <Plus size={18} aria-hidden /> Добави
                </button>
              </div>
            </form>
          )}

          <div className="parking-lottery-layout">
            <aside className="parking-lottery-aside">
              <h2>Томболи</h2>
              {lotteries.length === 0 ? (
                <p className="parking-lottery-muted">Няма записи.</p>
              ) : (
                <ul className="parking-lottery-list">
                  {lotteries.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className={
                          l.id === selectedId ? 'parking-lottery-list-btn active' : 'parking-lottery-list-btn'
                        }
                        onClick={() => setSelectedId(l.id)}
                      >
                        <span className="parking-lottery-year">
                          {l.year} · {l.round ?? 1}
                        </span>
                        {l.drawn_at ? (
                          <span className="parking-lottery-badge done">теглена</span>
                        ) : (
                          <span className="parking-lottery-badge draft">чернова</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <section className="parking-lottery-main">
              {!selected ? (
                <p className="parking-lottery-muted">Избери томбола от списъка.</p>
              ) : (
                <>
                  <div className="parking-lottery-detail-head">
                    <div>
                      <h2>
                        {selected.title?.trim() ||
                          `Томбола ${selected.year} (${selected.round ?? 1}. теглене)`}
                        <span className="parking-lottery-meta">
                          {' '}
                          · {selected.year} · тегл. {selected.round ?? 1}
                          {selected.drawn_at && (
                            <>
                              {' '}
                              · теглена{' '}
                              {format(new Date(selected.drawn_at), 'd MMM yyyy HH:mm', { locale: bg })}
                            </>
                          )}
                        </span>
                      </h2>
                    </div>
                    {edit && (
                      <div className="parking-lottery-actions">
                        {selected.drawn_at ? (
                          <button type="button" className="btn-secondary" onClick={() => void resetDraw()} disabled={saving}>
                            <RotateCcw size={18} aria-hidden /> Нулирай теглене
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void runDraw()}
                            disabled={
                              drawing ||
                              participants.length === 0 ||
                              parkingUnits.length === 0 ||
                              participants.length < parkingUnits.length
                            }
                          >
                            <Shuffle size={18} aria-hidden /> {drawing ? 'Теглене…' : 'Тегли'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-danger-outline"
                          onClick={() => void handleDeleteLottery(selected.id)}
                          disabled={saving}
                        >
                          <Trash2 size={18} aria-hidden /> Изтрий
                        </button>
                      </div>
                    )}
                  </div>

                  {parkingUnits.length > 0 && (
                    <p className="parking-lottery-parking-count">
                      Паркоместа в системата: <strong>{parkingUnits.length}</strong> — толкова са и печелившите при теглене.
                    </p>
                  )}

                  {prevLottery && (
                    <div className="parking-lottery-info">
                      <Info size={18} aria-hidden />
                      <div>
                        <strong>Предходна завършена томбола:</strong> {prevLottery.year} · тегл.{' '}
                        {prevLottery.round ?? 1}
                        {prevLottery.title ? ` — ${prevLottery.title}` : ''}. Участниците ѝ, които са отново в
                        текущата томбола, се подреждат <em>след</em> останалите.
                        {prevParticipants.length > 0 && (
                          <div className="parking-lottery-prev-emails">
                            Участници от {prevLottery.year} (тегл. {prevLottery.round ?? 1}):{' '}
                            {prevParticipants
                              .map((p) => p.email)
                              .sort()
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {resultsSorted.length > 0 ? (
                    <div className="parking-lottery-card">
                      <h3>
                        <Users size={20} aria-hidden /> Резултат — паркомясто и печеливш
                      </h3>
                      {edit && selected.drawn_at && (
                        <p className="parking-lottery-muted parking-lottery-reorder-hint">
                          Стрелките разменят печелившите между две съседни паркоместа (името на паркомястото не се мести).
                        </p>
                      )}
                      <table className="parking-lottery-table">
                        <thead>
                          <tr>
                            <th>№</th>
                            <th>Паркомясто</th>
                            <th>Печеливш</th>
                            <th>Бележка</th>
                            {edit && selected.drawn_at && <th className="parking-lottery-th-actions">Ръчно</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {resultsSorted.map((r, idx) => (
                            <tr key={r.id}>
                              <td>{r.sort_order}</td>
                              <td className="parking-lottery-cell-parking">{r.parking_label}</td>
                              <td>{r.email}</td>
                              <td>
                                {r.is_repeat ? (
                                  <span className="parking-lottery-tag repeat">Участвал в предходната</span>
                                ) : (
                                  <span className="parking-lottery-tag new">Първо участие спрямо предходната</span>
                                )}
                              </td>
                              {edit && selected.drawn_at && (
                                <td className="parking-lottery-cell-actions">
                                  <button
                                    type="button"
                                    className="parking-lottery-icon-btn"
                                    disabled={reorderSaving || idx === 0}
                                    onClick={() => void swapWinners(idx, idx - 1)}
                                    title="Размени с горния ред"
                                    aria-label="Нагоре"
                                  >
                                    <ChevronUp size={18} />
                                  </button>
                                  <button
                                    type="button"
                                    className="parking-lottery-icon-btn"
                                    disabled={reorderSaving || idx >= resultsSorted.length - 1}
                                    onClick={() => void swapWinners(idx, idx + 1)}
                                    title="Размени с долния ред"
                                    aria-label="Надолу"
                                  >
                                    <ChevronDown size={18} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="parking-lottery-muted">
                      {selected.drawn_at ? 'Няма записани резултати.' : 'Още не е теглено.'}
                    </p>
                  )}

                  {edit && selected.drawn_at && resultsSorted.length > 0 && (
                    <div className="parking-lottery-card parking-lottery-followup">
                      <h3>След приключване на томболата</h3>
                      <p className="parking-lottery-muted">
                        <strong>Публикувай</strong> — ново съобщение с текста на резултата (видимо за всички).{' '}
                        <strong>Обнови връзките</strong> — за всяко паркомясто от таблицата се настройва кой
                        потребител го вижда в „Мои обекти“ (старите връзки към тези паркоместа се заменят).
                      </p>
                      <div className="parking-lottery-followup-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={publishing || applyingLinks}
                          onClick={() => void publishResultsAnnouncement()}
                        >
                          <Megaphone size={18} aria-hidden /> {publishing ? 'Публикуване…' : 'Публикувай'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={publishing || applyingLinks}
                          onClick={() => void applyParkingLinksFromResults()}
                        >
                          <RefreshCw size={18} aria-hidden /> {applyingLinks ? 'Обновяване…' : 'Обнови връзките'}
                        </button>
                      </div>
                    </div>
                  )}

                  {edit && (
                    <div className="parking-lottery-card">
                      <h3>Участници в тази томбола</h3>
                      {selected.drawn_at ? (
                        <p className="parking-lottery-muted">
                          Томболата е теглена. Нулирай тегленето, за да променяш списъка.
                        </p>
                      ) : (
                        <>
                          <div className="parking-lottery-user-grid">
                            {allUsers.map((u) => (
                              <label key={u.id} className="parking-lottery-check">
                                <input
                                  type="checkbox"
                                  checked={selectedUserIds.has(u.id)}
                                  onChange={() => toggleUser(u.id)}
                                />
                                <span>{u.email}</span>
                              </label>
                            ))}
                          </div>
                          {allUsers.length === 0 && (
                            <p className="parking-lottery-muted">Няма потребители в системата.</p>
                          )}
                          <button
                            type="button"
                            className="btn-primary parking-lottery-save"
                            onClick={() => void saveParticipants()}
                            disabled={saving || selected.drawn_at !== null}
                          >
                            Запази участниците
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
