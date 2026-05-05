import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { bg } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { paymentDescriptionLine, paymentMethodLabels } from '../lib/paymentDescription'
import { Plus, Edit2, Trash2, Filter, Archive, ArchiveRestore } from 'lucide-react'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { formatUnitNumberDisplay, sortUnitsByTypeAndNumber } from '../lib/unitNumber'
import type { UnitGroup } from '../types/unitGroup'
import './Units.css'

interface Unit {
  id: string
  group_id: string
  type: string
  number: string
  archived?: boolean
  /** % ид. части сграда */
  building_ideal_share_percent?: number | string | null
  owner_name?: string
  owner_email: string | null
  owner_phone: string | null
  tenant_name: string | null
  tenant_email: string | null
  tenant_phone: string | null
  notes: string | null
  floor?: string | null
  opening_balance?: number | string | null
  created_at: string
  group?: UnitGroup | null
}

const unitSelectFields = `
          *,
          group:group_id (*)
        `

/** Брой плащания с описание/приспадане/начин (като «Задължения») на обект в «Мои обекти». */
const VIEWER_PAYMENTS_LIMIT = 8

type ViewerUnitPayment = {
  id: string
  displayDate: string
  description: string
  methodLabel: string
  amount: number
}

type PaymentRowForViewer = {
  id: string
  unit_id: string
  amount: number | string
  payment_date: string | null
  created_at?: string | null
  notes: string | null
  payment_method: string | null
  payment_allocations: {
    amount: number | string
    unit_obligations: { title: string; kind: string } | null
  }[] | null
  income: {
    type: string
    description: string
    date: string
    period_start: string | null
    period_end: string | null
  } | null
}

function paymentDateSortValue(p: { payment_date: string | null; created_at?: string | null }): number {
  const d = p.payment_date || (p.created_at ? p.created_at.split('T')[0] : null)
  return d ? new Date(d).getTime() : 0
}

function formatMoneyBg(n: number): string {
  return `${n.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function parseIdealShareNumber(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'string' ? parseFloat(String(v).replace(',', '.')) : Number(v)
  return Number.isFinite(n) ? n : null
}

function formatIdealSharePercent(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = parseIdealShareNumber(v)
  if (n == null) return '—'
  return `${n.toLocaleString('bg-BG', { minimumFractionDigits: 3, maximumFractionDigits: 6 })} %`
}

function formatIdealShareSum(total: number): string {
  return `${total.toLocaleString('bg-BG', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`
}

export default function Units() {
  const { canEdit, userRole, user } = useAuth()
  const isViewer = userRole === 'viewer'
  const { groups, loading: groupsLoading, labelForCode } = useUnitGroups()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)
  const [filterGroupId, setFilterGroupId] = useState<string | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const UNITS_PAGE_SIZE = 12
  /** За viewer: редове задължения с остатък по unit_id. */
  const [viewerDueLines, setViewerDueLines] = useState<Record<string, { title: string; rem: number }[]>>({})
  /** За viewer: последни плащания по unit_id. */
  const [viewerUnitPayments, setViewerUnitPayments] = useState<Record<string, ViewerUnitPayment[]>>({})
  const [formData, setFormData] = useState({
    group_id: '',
    number: '',
    building_ideal_share_percent: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    tenant_name: '',
    tenant_email: '',
    tenant_phone: '',
    notes: '',
    floor: '',
  })

  const buildViewerUnitPayments = (ids: string[], pays: PaymentRowForViewer[] | null) => {
    const grouped: Record<string, PaymentRowForViewer[]> = {}
    for (const uid of ids) grouped[uid] = []
    for (const p of pays || []) {
      if (!grouped[p.unit_id]) grouped[p.unit_id] = []
      grouped[p.unit_id].push(p)
    }
    const out: Record<string, ViewerUnitPayment[]> = {}
    for (const uid of ids) {
      const list: ViewerUnitPayment[] = (grouped[uid] || [])
        .sort((a, b) => paymentDateSortValue(b) - paymentDateSortValue(a))
        .slice(0, VIEWER_PAYMENTS_LIMIT)
        .map((p) => {
          const dRaw = p.payment_date || (p.created_at ? p.created_at.split('T')[0] : null)
          const displayDate = dRaw ? format(new Date(dRaw), 'd.MM.yyyy', { locale: bg }) : '—'
          const desc = paymentDescriptionLine({
            income: p.income,
            payment_allocations: p.payment_allocations,
            notes: p.notes,
          })
          const m =
            p.payment_method && paymentMethodLabels[p.payment_method]
              ? paymentMethodLabels[p.payment_method]
              : '—'
          const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : Number(p.amount)
          return {
            id: p.id,
            displayDate,
            description: desc,
            methodLabel: m,
            amount: Number.isFinite(amt) ? amt : 0,
          }
        })
      out[uid] = list
    }
    return out
  }

  const loadViewerData = async (userId: string) => {
    setUnits([])
    setViewerDueLines({})
    setViewerUnitPayments({})
    const { data: links, error: linkErr } = await supabase
      .from('user_unit_links')
      .select('unit_id')
      .eq('user_id', userId)
    if (linkErr) throw linkErr
    const ids = (links || []).map((r: { unit_id: string }) => r.unit_id)
    if (ids.length === 0) return
    const { data, error } = await supabase
      .from('units')
      .select(unitSelectFields)
      .in('id', ids)
      .eq('archived', false)
    if (error) throw error
    const list = sortUnitsByTypeAndNumber((data as Unit[]) || [])
    setUnits(list)
    const { data: obl, error: oblErr } = await supabase
      .from('unit_obligations')
      .select('unit_id, title, amount_remaining')
      .in('unit_id', ids)
      .gt('amount_remaining', 0.005)
    if (!oblErr && obl) {
      const m: Record<string, { title: string; rem: number }[]> = {}
      for (const raw of obl) {
        const r = raw as { unit_id: string; title: string; amount_remaining: number | string }
        const rem = typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
        if (!Number.isFinite(rem) || rem <= 0) continue
        if (!m[r.unit_id]) m[r.unit_id] = []
        m[r.unit_id].push({ title: r.title || 'Задължение', rem })
      }
      setViewerDueLines(m)
    } else {
      setViewerDueLines({})
    }
    const { data: payData, error: payErr } = await supabase
      .from('payments')
      .select(
        `id, unit_id, amount, payment_date, created_at, status, notes, payment_method,
         payment_allocations ( amount, unit_obligations ( title, kind ) ),
         income:income_id ( type, description, date, period_start, period_end )`
      )
      .in('unit_id', ids)
      .eq('status', 'paid')
    if (payErr) {
      console.error('viewer unit payments', payErr)
      setViewerUnitPayments({})
      return
    }
    setViewerUnitPayments(buildViewerUnitPayments(ids, (payData as PaymentRowForViewer[]) || null))
  }

  useEffect(() => {
    void loadData()
  }, [user?.id, userRole])

  const pageLoading = loading || groupsLoading

  const loadData = async () => {
    setLoading(true)
    try {
      if (isViewer) {
        if (!user?.id) {
          setUnits([])
          setViewerDueLines({})
          setViewerUnitPayments({})
          return
        }
        await loadViewerData(user.id)
        return
      }

      const { data, error } = await supabase
        .from('units')
        .select(unitSelectFields)
        .order('type', { ascending: true })
        .order('number', { ascending: true })
      if (error) throw error
      setUnits((data as Unit[]) || [])
    } catch (error) {
      console.error('Error loading units:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      if (isViewer) {
        if (!user?.id) {
          setUnits([])
          setViewerDueLines({})
          setViewerUnitPayments({})
          return
        }
        await loadViewerData(user.id)
        return
      }
      const { data, error } = await supabase
        .from('units')
        .select(unitSelectFields)
        .order('type', { ascending: true })
        .order('number', { ascending: true })
      if (error) throw error
      setUnits((data as Unit[]) || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isViewer) return
    try {
      const selectedGroup = groups.find((g) => g.id === formData.group_id)
      if (!selectedGroup) {
        alert('Изберете група обект.')
        return
      }

      const shareRaw = formData.building_ideal_share_percent.trim().replace(',', '.')
      const share = parseFloat(shareRaw)
      if (Number.isNaN(share) || share <= 0 || share > 100) {
        alert('Полето „% ид. части сграда“ трябва да е между 0 и 100 (напр. 1,952 или 2.5).')
        return
      }

      const unitData: Record<string, unknown> = {
        group_id: formData.group_id,
        type: selectedGroup.code,
        number: formData.number,
        building_ideal_share_percent: share,
        owner_name: formData.owner_name,
        owner_email: formData.owner_email || null,
        owner_phone: formData.owner_phone || null,
        tenant_name: formData.tenant_name || null,
        tenant_email: formData.tenant_email || null,
        tenant_phone: formData.tenant_phone || null,
        notes: formData.notes || null,
        floor: formData.floor.trim() || null,
      }

      if (editingUnit) {
        const { error } = await supabase
          .from('units')
          .update(unitData)
          .eq('id', editingUnit.id)

        if (error) {
          console.error('Error updating unit:', error)
          throw error
        }
      } else {
        const { error } = await supabase.from('units').insert({ ...unitData, archived: false })

        if (error) {
          console.error('Error inserting unit:', error)
          console.error('Unit data:', unitData)
          throw error
        }
      }

      setShowModal(false)
      setEditingUnit(null)
      resetForm()
      fetchUnits()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при запазване'
      alert(msg)
    }
  }

  const handleEdit = (unit: Unit) => {
    if (isViewer) return
    setEditingUnit(unit)
    setFormData({
      group_id: unit.group_id,
      number: unit.number,
      building_ideal_share_percent: String(unit.building_ideal_share_percent ?? ''),
      owner_name: unit.owner_name ?? '',
      owner_email: unit.owner_email || '',
      owner_phone: unit.owner_phone || '',
      tenant_name: unit.tenant_name || '',
      tenant_email: unit.tenant_email || '',
      tenant_phone: unit.tenant_phone || '',
      notes: unit.notes || '',
      floor: unit.floor ?? '',
    })
    setShowModal(true)
  }

  const handleToggleArchive = async (unit: Unit) => {
    if (isViewer) return
    if (!canEdit()) return
    const next = !unit.archived
    if (
      !confirm(
        next
          ? `Архивиране на обект „${unit.group?.name ?? labelForCode(unit.type)} ${formatUnitNumberDisplay(unit.number)}“? Ще изчезне от падащите списъци за задължения.`
          : `Възстановяване на обект от архива?`
      )
    ) {
      return
    }
    try {
      const { error } = await supabase.from('units').update({ archived: next }).eq('id', unit.id)
      if (error) throw error
      void fetchUnits()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка'
      if (msg.includes('archived') || msg.includes('column')) {
        alert(`${msg}\n\nИзпълни миграция database_migrations/054_units_archived.sql в Supabase.`)
        return
      }
      alert(msg)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този обект?')) return

    try {
      const { error } = await supabase.from('units').delete().eq('id', id)
      if (error) throw error
      fetchUnits()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при изтриване'
      alert(msg)
    }
  }

  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name, 'bg'))

  const resetForm = () => {
    const defaultGroupId = sortedGroups[0]?.id ?? ''
    setFormData({
      group_id: defaultGroupId,
      number: '',
      building_ideal_share_percent: '',
      owner_name: '',
      owner_email: '',
      owner_phone: '',
      tenant_name: '',
      tenant_email: '',
      tenant_phone: '',
      notes: '',
      floor: '',
    })
  }

  const openNewModal = () => {
    setEditingUnit(null)
    resetForm()
    setShowModal(true)
  }

  const afterGroup = isViewer
    ? units
    : filterGroupId === 'all'
      ? units
      : units.filter((unit) => unit.group_id === filterGroupId)
  const filteredUnits = isViewer
    ? afterGroup
    : afterGroup.filter((u) => showArchived || !u.archived)
  const sortedList = sortUnitsByTypeAndNumber(filteredUnits)
  const pageCount = Math.max(1, Math.ceil(sortedList.length / UNITS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedUnits = sortedList.slice((safePage - 1) * UNITS_PAGE_SIZE, safePage * UNITS_PAGE_SIZE)

  /** Сума на % ид. части по текущия филтър (активни/архивирани, група). */
  const idealShareSumListed = useMemo(() => {
    let s = 0
    let any = false
    for (const u of sortedList) {
      const n = parseIdealShareNumber(u.building_ideal_share_percent)
      if (n != null) {
        s += n
        any = true
      }
    }
    return any ? s : null
  }, [sortedList])

  useEffect(() => {
    setPage(1)
  }, [filterGroupId, showArchived, isViewer])

  if (pageLoading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="units-page">
      <div className="page-header">
        <div>
          <h1>{isViewer ? 'Мои обекти' : 'Обекти'}</h1>
          <p>
            {isViewer
              ? 'Пълни данни за свързаните с акаунта обекти (само преглед) — идеални части, контакти, остатъци по задължения и последните плащания с описание и приспадане като в „Задължения“.'
              : 'Управление на апартаменти, гаражи, магазини и паркоместа'}
          </p>
          {canEdit() && (
            <p className="units-page-subhint">
              Пренесен дълг (старо задължение) се въвежда от{' '}
              <Link to="/obligations">Задължения</Link> — бутон „Пренесен дълг по обект“.
            </p>
          )}
        </div>
        {canEdit() && (
          <button className="btn-primary" onClick={openNewModal}>
            <Plus size={20} />
            Добави обект
          </button>
        )}
      </div>

      {!isViewer && (
        <div className="filter-section">
          <div className="filter-group">
            <Filter size={18} />
            <select
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value as string | 'all')}
              className="filter-select"
            >
              <option value="all">Всички групи</option>
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group units-archive-filter">
            <label>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />{' '}
              Покажи архивирани
            </label>
          </div>
          <div className="units-count">
            {sortedList.length} обекта
            {idealShareSumListed != null && (
              <> · Сума ид. части: {formatIdealShareSum(idealShareSumListed)}</>
            )}
            {pageCount > 1 ? ` · стр. ${safePage}/${pageCount}` : ''}
          </div>
        </div>
      )}

      {isViewer && sortedList.length > 0 && (
        <div className="viewer-units-count">
          {sortedList.length} {sortedList.length === 1 ? 'обект' : 'обекта'}
          {idealShareSumListed != null && (
            <> · Сума ид. части: {formatIdealShareSum(idealShareSumListed)}</>
          )}
          {pageCount > 1 ? ` · стр. ${safePage}/${pageCount}` : ''}
        </div>
      )}

      <div className="units-table-wrap">
        {sortedList.length === 0 ? (
          <div className="empty-state">
            {isViewer
              ? 'Няма свързани обекти към вашия акаунт. Помолете домоуправителя да ви добави към вашия апартамент / обект.'
              : 'Няма регистрирани обекти за този филтър.'}
          </div>
        ) : isViewer ? (
          <>
            <div className="viewer-units-list">
              {pagedUnits.map((unit) => {
                const label = `${unit.group?.name ?? labelForCode(unit.type)} ${formatUnitNumberDisplay(unit.number)}`
                const lines = viewerDueLines[unit.id]
                const pays = viewerUnitPayments[unit.id] ?? []
                const hasTenant = [unit.tenant_name, unit.tenant_email, unit.tenant_phone].some(
                  (x) => (x?.trim()?.length ?? 0) > 0
                )
                const created = unit.created_at
                  ? format(new Date(unit.created_at), 'd.MM.yyyy', { locale: bg })
                  : '—'
                const d = (v: string | null | undefined) => (v?.trim() ? v.trim() : '—')
                return (
                  <article key={unit.id} className="viewer-unit-card">
                    <h2 className="viewer-unit-title">{label}</h2>
                    <dl className="viewer-unit-dl">
                      <div>
                        <dt>Група</dt>
                        <dd>{unit.group?.name ?? labelForCode(unit.type)}</dd>
                      </div>
                      <div>
                        <dt>Етаж</dt>
                        <dd>{d(unit.floor)}</dd>
                      </div>
                      <div>
                        <dt>% ид. части сграда</dt>
                        <dd>{formatIdealSharePercent(unit.building_ideal_share_percent)}</dd>
                      </div>
                      <div>
                        <dt>Собственик</dt>
                        <dd>
                          {d(unit.owner_name)}
                          <div className="viewer-unit-dl-sub">
                            <span>Имейл: {d(unit.owner_email)}</span>
                            <span>Телефон: {d(unit.owner_phone)}</span>
                          </div>
                        </dd>
                      </div>
                      {hasTenant && (
                        <div>
                          <dt>Наемател</dt>
                          <dd>
                            {d(unit.tenant_name)}
                            <div className="viewer-unit-dl-sub">
                              <span>Имейл: {d(unit.tenant_email)}</span>
                              <span>Телефон: {d(unit.tenant_phone)}</span>
                            </div>
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Бележки</dt>
                        <dd className="viewer-unit-notes">{d(unit.notes)}</dd>
                      </div>
                      <div>
                        <dt>Обект в системата</dt>
                        <dd>от {created}</dd>
                      </div>
                    </dl>
                    <section className="viewer-unit-section" aria-label="Остатъци по задължения">
                      <h3 className="viewer-unit-h3">Остатъци по задължения</h3>
                      {lines && lines.length > 0 ? (
                        <ul className="viewer-due-list">
                          {lines.map((line, i) => (
                            <li key={`${line.title}-${i}`}>
                              <span className="viewer-due-title">{line.title}</span>{' '}
                              <span className="viewer-due-amt">{formatMoneyBg(line.rem)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="viewer-empty-line">Няма остатък</p>
                      )}
                    </section>
                    <section className="viewer-unit-section" aria-label="Последни плащания">
                      <h3 className="viewer-unit-h3">Последни плащания (до {VIEWER_PAYMENTS_LIMIT})</h3>
                      {pays.length > 0 ? (
                        <div className="table-wrap viewer-payments-table-wrap">
                          <table className="data-table viewer-payments-table">
                            <thead>
                              <tr>
                                <th>Дата</th>
                                <th>Описание / приспадане</th>
                                <th>Начин</th>
                                <th className="num">Сума</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pays.map((p) => (
                                <tr key={p.id}>
                                  <td>{p.displayDate}</td>
                                  <td className="viewer-payment-desc">{p.description}</td>
                                  <td>{p.methodLabel}</td>
                                  <td className="num">{formatMoneyBg(p.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="viewer-empty-line">Няма регистрирани плащания</p>
                      )}
                    </section>
                  </article>
                )
              })}
            </div>
            {pageCount > 1 && (
              <div className="units-pager">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </button>
                <span>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Напред
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table units-data-table">
                <thead>
                  <tr>
                    <th>Обект</th>
                    <th>Етаж</th>
                    <th className="num">% ид. части</th>
                    <th>Собственик</th>
                    <th>Статус</th>
                    {canEdit() && <th>Действия</th>}
                  </tr>
                </thead>
                <tbody>
                  {pagedUnits.map((unit) => {
                    const label = `${unit.group?.name ?? labelForCode(unit.type)} ${formatUnitNumberDisplay(unit.number)}`
                    return (
                      <tr key={unit.id} className={unit.archived ? 'units-row-archived' : undefined}>
                        <td>
                          <strong>{label}</strong>
                        </td>
                        <td>{unit.floor?.trim() || '—'}</td>
                        <td className="num">{formatIdealSharePercent(unit.building_ideal_share_percent)}</td>
                        <td>{unit.owner_name ?? '—'}</td>
                        <td>
                          {unit.archived ? (
                            <span className="units-badge units-badge-archived">Архив</span>
                          ) : (
                            <span className="units-badge units-badge-active">Активен</span>
                          )}
                        </td>
                        {canEdit() && (
                          <td>
                            <div className="unit-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => handleEdit(unit)}
                                title="Редактирай"
                              >
                                <Edit2 size={18} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => void handleToggleArchive(unit)}
                                title={unit.archived ? 'Възстанови от архив' : 'Архивирай'}
                              >
                                {unit.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => handleDelete(unit.id)}
                                title="Изтрий"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="units-pager">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </button>
                <span>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Напред
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && canEdit() && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUnit ? 'Редактирай обект' : 'Добави обект'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Група обект *</label>
                <select
                  value={formData.group_id}
                  onChange={(e) => {
                    setFormData({ ...formData, group_id: e.target.value })
                  }}
                  required
                >
                  <option value="">Изберете…</option>
                  {sortedGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Номер *</label>
                <input
                  type="text"
                  value={formData.number}
                  onChange={(e) =>
                    setFormData({ ...formData, number: e.target.value })
                  }
                  required
                  placeholder="Напр. 5, 12, A1"
                />
              </div>

              <div className="form-group">
                <label>% ид. части сграда *</label>
                <input
                  type="number"
                  step="0.001"
                  value={formData.building_ideal_share_percent}
                  onChange={(e) =>
                    setFormData({ ...formData, building_ideal_share_percent: e.target.value })
                  }
                  required
                  min="0.001"
                  max="100"
                  placeholder="Напр. 1,952"
                />
              </div>

              <div className="form-group">
                <label>Етаж</label>
                <input
                  type="text"
                  value={formData.floor}
                  onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                  placeholder="Напр. 5, партер, мансарда"
                />
              </div>

              <div className="form-section">
                <h3>Собственик</h3>
                <div className="form-group">
                  <label>Име на собственик *</label>
                  <input
                    type="text"
                    value={formData.owner_name}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Имейл на собственик</label>
                  <input
                    type="email"
                    value={formData.owner_email}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Телефон на собственик</label>
                  <input
                    type="tel"
                    value={formData.owner_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, owner_phone: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-section">
                <h3>Наемател (опционално)</h3>
                <div className="form-group">
                  <label>Име на наемател</label>
                  <input
                    type="text"
                    value={formData.tenant_name}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_name: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Имейл на наемател</label>
                  <input
                    type="email"
                    value={formData.tenant_email}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Телефон на наемател</label>
                  <input
                    type="tel"
                    value={formData.tenant_phone}
                    onChange={(e) =>
                      setFormData({ ...formData, tenant_phone: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Бележки</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Отказ
                </button>
                <button type="submit" className="btn-primary">
                  Запази
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
