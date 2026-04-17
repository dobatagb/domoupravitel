import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CalendarRange, Plus, Edit2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import type { UnitGroup } from '../types/unitGroup'
import './Units.css'
import './BillingPeriods.css'

export interface BillingPeriod {
  id: string
  name: string
  date_from: string
  date_to: string
  is_closed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

function parseAmount(raw: string): number {
  const t = raw.trim().replace(',', '.')
  if (!t) return 0
  const n = parseFloat(t)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export default function BillingPeriods() {
  const { canEdit } = useAuth()
  const [periods, setPeriods] = useState<BillingPeriod[]>([])
  const [groups, setGroups] = useState<UnitGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAmounts, setSavingAmounts] = useState(false)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({})

  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null)
  const [periodForm, setPeriodForm] = useState({
    name: '',
    date_from: '',
    date_to: '',
    is_closed: false,
    sort_order: '0',
  })
  const [savingPeriod, setSavingPeriod] = useState(false)

  const loadGroups = useCallback(async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase.from('unit_groups').select('id, code, name, list_label_short').order('name', {
        ascending: true,
      })
    )
    if (error) throw error
    setGroups((data as UnitGroup[]) || [])
  }, [])

  const loadPeriods = useCallback(async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase.from('billing_periods').select('*').order('sort_order', { ascending: true }).order('date_from', {
        ascending: false,
      })
    )
    if (error) throw error
    setPeriods((data as BillingPeriod[]) || [])
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadPeriods(), loadGroups()])
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [loadPeriods, loadGroups])

  const loadAmountsForPeriod = useCallback(async (periodId: string) => {
    const { data, error } = await supabaseQuery(() =>
      supabase.from('period_group_amounts').select('group_id, amount').eq('period_id', periodId)
    )
    if (error) throw error
    const map: Record<string, string> = {}
    for (const g of groups) {
      map[g.id] = ''
    }
    for (const row of data || []) {
      const r = row as { group_id: string; amount: number }
      map[r.group_id] = String(r.amount)
    }
    setAmountDraft(map)
  }, [groups])

  useEffect(() => {
    if (!selectedPeriodId || groups.length === 0) {
      setAmountDraft({})
      return
    }
    void loadAmountsForPeriod(selectedPeriodId).catch(console.error)
  }, [selectedPeriodId, groups, loadAmountsForPeriod])

  const openNewPeriod = () => {
    setEditingPeriod(null)
    const nextSort = periods.length ? Math.max(...periods.map((p) => p.sort_order)) + 10 : 10
    setPeriodForm({
      name: '',
      date_from: '',
      date_to: '',
      is_closed: false,
      sort_order: String(nextSort),
    })
    setShowPeriodModal(true)
  }

  const openEditPeriod = (p: BillingPeriod) => {
    setEditingPeriod(p)
    setPeriodForm({
      name: p.name,
      date_from: p.date_from.slice(0, 10),
      date_to: p.date_to.slice(0, 10),
      is_closed: p.is_closed,
      sort_order: String(p.sort_order),
    })
    setShowPeriodModal(true)
  }

  const savePeriod = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const sort = parseInt(periodForm.sort_order, 10)
    if (Number.isNaN(sort)) {
      alert('Редът за сортиране трябва да е число.')
      return
    }
    if (!periodForm.name.trim()) {
      alert('Въведи име на периода.')
      return
    }
    if (!periodForm.date_from || !periodForm.date_to) {
      alert('Попълни датите от и до.')
      return
    }
    if (periodForm.date_from > periodForm.date_to) {
      alert('Началната дата трябва да е преди крайната.')
      return
    }
    setSavingPeriod(true)
    try {
      const row = {
        name: periodForm.name.trim(),
        date_from: periodForm.date_from,
        date_to: periodForm.date_to,
        is_closed: periodForm.is_closed,
        sort_order: sort,
        updated_at: new Date().toISOString(),
      }
      if (editingPeriod) {
        const { error } = await supabase.from('billing_periods').update(row).eq('id', editingPeriod.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('billing_periods').insert(row)
        if (error) throw error
      }
      setShowPeriodModal(false)
      await loadPeriods()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис'
      alert(msg)
    } finally {
      setSavingPeriod(false)
    }
  }

  const deletePeriod = async (p: BillingPeriod) => {
    if (!canEdit()) return
    if (!confirm(`Изтриване на период „${p.name}“? Сумите по групи за този период също ще се изтрият.`)) return
    try {
      const { error } = await supabase.from('billing_periods').delete().eq('id', p.id)
      if (error) throw error
      if (selectedPeriodId === p.id) setSelectedPeriodId('')
      await loadPeriods()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка')
    }
  }

  const saveAmounts = async () => {
    if (!canEdit() || !selectedPeriodId) return
    const p = periods.find((x) => x.id === selectedPeriodId)
    if (p?.is_closed) {
      alert('Периодът е затворен за редакция.')
      return
    }
    setSavingAmounts(true)
    try {
      const now = new Date().toISOString()
      const rows = groups.map((g) => ({
        period_id: selectedPeriodId,
        group_id: g.id,
        amount: parseAmount(amountDraft[g.id] ?? ''),
        updated_at: now,
      }))
      const { error } = await supabase.from('period_group_amounts').upsert(rows, {
        onConflict: 'period_id,group_id',
      })
      if (error) throw error
      alert('Записано.')
    } catch (err: unknown) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Грешка при запис на суми')
    } finally {
      setSavingAmounts(false)
    }
  }

  const selectedPeriod = periods.find((x) => x.id === selectedPeriodId)
  const amountsLocked = selectedPeriod?.is_closed ?? false

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="billing-periods-page">
      <div className="page-header billing-periods-header">
        <div>
          <h1>
            <CalendarRange size={28} className="page-header-icon" aria-hidden />
            Периоди и такси по групи
          </h1>
          <p>
            За всеки период задаваш сума по <strong>група обекти</strong>. Всички единици от групата ползват същата
            сума за този период.
          </p>
        </div>
        {canEdit() && (
          <button type="button" className="btn-primary" onClick={openNewPeriod}>
            <Plus size={20} />
            Нов период
          </button>
        )}
      </div>

      <div className="billing-card">
        <h2 className="billing-section-title">Периоди</h2>
        {periods.length === 0 ? (
          <p className="billing-empty">Няма дефинирани периоди. Добави първия с „Нов период“.</p>
        ) : (
          <div className="table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Име</th>
                  <th>От</th>
                  <th>До</th>
                  <th>Ред</th>
                  <th>Статус</th>
                  {canEdit() && <th>Действия</th>}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className={selectedPeriodId === p.id ? 'row-selected' : undefined}>
                    <td>
                      <button
                        type="button"
                        className="link-like"
                        onClick={() => setSelectedPeriodId(p.id)}
                      >
                        {p.name}
                      </button>
                    </td>
                    <td>{format(new Date(p.date_from), 'dd.MM.yyyy', { locale: bg })}</td>
                    <td>{format(new Date(p.date_to), 'dd.MM.yyyy', { locale: bg })}</td>
                    <td>{p.sort_order}</td>
                    <td>{p.is_closed ? 'Затворен' : 'Отворен'}</td>
                    {canEdit() && (
                      <td className="actions-cell">
                        <button type="button" className="icon-btn" title="Редактирай" onClick={() => openEditPeriod(p)}>
                          <Edit2 size={18} />
                        </button>
                        <button type="button" className="icon-btn danger" title="Изтрий" onClick={() => void deletePeriod(p)}>
                          <Trash2 size={18} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="billing-card">
        <h2 className="billing-section-title">Суми по групи за избран период</h2>
        {groups.length === 0 ? (
          <p className="billing-empty">Няма активни групи в номенклатурата.</p>
        ) : (
          <>
            <div className="form-group billing-select-row">
              <label htmlFor="period-select">Период</label>
              <select
                id="period-select"
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
              >
                <option value="">— избери —</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({format(new Date(p.date_from), 'dd.MM.yyyy', { locale: bg })} –{' '}
                    {format(new Date(p.date_to), 'dd.MM.yyyy', { locale: bg })})
                  </option>
                ))}
              </select>
            </div>

            {selectedPeriodId && (
              <>
                {amountsLocked && (
                  <p className="billing-hint billing-hint-warn">Този период е затворен — сумите не се редактират.</p>
                )}
                <div className="table-wrap">
                  <table className="billing-table">
                    <thead>
                      <tr>
                        <th>Група</th>
                        <th>Код</th>
                        <th>Сума (лв)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.id}>
                          <td>{g.name}</td>
                          <td>
                            <code className="code-inline">{g.code}</code>
                          </td>
                          <td>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="billing-amount-input"
                              disabled={!canEdit() || amountsLocked}
                              value={amountDraft[g.id] ?? ''}
                              onChange={(e) =>
                                setAmountDraft((d) => ({ ...d, [g.id]: e.target.value }))
                              }
                              placeholder="0"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit() && !amountsLocked && (
                  <div className="billing-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={savingAmounts}
                      onClick={() => void saveAmounts()}
                    >
                      {savingAmounts ? 'Запис…' : 'Запази суми'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {showPeriodModal && (
        <div className="modal-overlay" onClick={() => !savingPeriod && setShowPeriodModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingPeriod ? 'Редактирай период' : 'Нов период'}</h2>
            <form onSubmit={savePeriod}>
              <div className="form-group">
                <label htmlFor="bp-name">Име *</label>
                <input
                  id="bp-name"
                  value={periodForm.name}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  disabled={savingPeriod}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bp-from">От *</label>
                <input
                  id="bp-from"
                  type="date"
                  value={periodForm.date_from}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, date_from: e.target.value }))}
                  required
                  disabled={savingPeriod}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bp-to">До *</label>
                <input
                  id="bp-to"
                  type="date"
                  value={periodForm.date_to}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, date_to: e.target.value }))}
                  required
                  disabled={savingPeriod}
                />
              </div>
              <div className="form-group">
                <label htmlFor="bp-sort">Ред</label>
                <input
                  id="bp-sort"
                  type="number"
                  value={periodForm.sort_order}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, sort_order: e.target.value }))}
                  disabled={savingPeriod}
                />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={periodForm.is_closed}
                    onChange={(e) => setPeriodForm((f) => ({ ...f, is_closed: e.target.checked }))}
                    disabled={savingPeriod}
                  />
                  <span>Затворен (без редакция на суми)</span>
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" disabled={savingPeriod} onClick={() => setShowPeriodModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary" disabled={savingPeriod}>
                  {savingPeriod ? 'Запис…' : 'Запази'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
