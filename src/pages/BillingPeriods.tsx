import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseQuery } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CalendarRange, Plus, Edit2, Trash2, Copy } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import type { UnitGroup } from '../types/unitGroup'
import { compactGroupLabel } from '../lib/unitDisplay'
import './Units.css'
import './BillingPeriods.css'

interface UnitForOverride {
  id: string
  number: string
  group_id: string
  group?: { name: string; code: string; list_label_short: string | null } | null
}

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
  const [unitsForOverrides, setUnitsForOverrides] = useState<UnitForOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAmounts, setSavingAmounts] = useState(false)
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({})
  /** Индивидуална сума по unit_id; празно = ползва се само сумата по група. */
  const [unitOverrideDraft, setUnitOverrideDraft] = useState<Record<string, string>>({})

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
  const [copyingPeriodId, setCopyingPeriodId] = useState<string | null>(null)

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

  const loadUnitsForOverrides = useCallback(async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase
        .from('units')
        .select('id, number, group_id, group:group_id(name, code, list_label_short)')
        .order('type', { ascending: true })
        .order('number', { ascending: true })
    )
    if (error) throw error
    const raw = (data ?? []) as unknown[]
    setUnitsForOverrides(
      raw.map((row) => {
        const r = row as UnitForOverride & { group?: { name: string; code: string; list_label_short: string | null } | unknown[] | null }
        const g = r.group
        const group = Array.isArray(g) ? (g[0] as UnitForOverride['group']) ?? null : g ?? null
        return { ...r, group }
      })
    )
  }, [])

  useEffect(() => {
    if (!canEdit()) return
    void loadUnitsForOverrides().catch(console.error)
  }, [canEdit, loadUnitsForOverrides])

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

  const loadUnitOverridesForPeriod = useCallback(
    async (periodId: string) => {
      if (unitsForOverrides.length === 0) {
        setUnitOverrideDraft({})
        return
      }
      const { data, error } = await supabaseQuery(() =>
        supabase.from('period_unit_amounts').select('unit_id, amount').eq('period_id', periodId)
      )
      if (error) throw error
      const map: Record<string, string> = {}
      for (const u of unitsForOverrides) {
        map[u.id] = ''
      }
      for (const row of data || []) {
        const r = row as { unit_id: string; amount: number }
        map[r.unit_id] = String(r.amount)
      }
      setUnitOverrideDraft(map)
    },
    [unitsForOverrides]
  )

  useEffect(() => {
    if (!selectedPeriodId || groups.length === 0) {
      setAmountDraft({})
      return
    }
    void loadAmountsForPeriod(selectedPeriodId).catch(console.error)
  }, [selectedPeriodId, groups, loadAmountsForPeriod])

  useEffect(() => {
    if (!selectedPeriodId || unitsForOverrides.length === 0) {
      setUnitOverrideDraft({})
      return
    }
    void loadUnitOverridesForPeriod(selectedPeriodId).catch(console.error)
  }, [selectedPeriodId, unitsForOverrides, loadUnitOverridesForPeriod])

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

  const copyPeriod = async (p: BillingPeriod) => {
    if (!canEdit()) return
    setCopyingPeriodId(p.id)
    try {
      const nextSort = periods.length ? Math.max(...periods.map((x) => x.sort_order)) + 10 : 10
      const { data: inserted, error: insErr } = await supabase
        .from('billing_periods')
        .insert({
          name: `${p.name} (копие)`,
          date_from: p.date_from.slice(0, 10),
          date_to: p.date_to.slice(0, 10),
          is_closed: false,
          sort_order: nextSort,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (insErr) throw insErr
      const newId = inserted.id as string

      const { data: amounts, error: amtErr } = await supabase
        .from('period_group_amounts')
        .select('group_id, amount')
        .eq('period_id', p.id)
      if (amtErr) throw amtErr

      const now = new Date().toISOString()
      if (amounts && amounts.length > 0) {
        const rows = amounts.map((row: { group_id: string; amount: number }) => ({
          period_id: newId,
          group_id: row.group_id,
          amount: row.amount,
          updated_at: now,
        }))
        const { error: upErr } = await supabase.from('period_group_amounts').upsert(rows, {
          onConflict: 'period_id,group_id',
        })
        if (upErr) throw upErr
      }

      const { data: unitAmts, error: uaErr } = await supabase
        .from('period_unit_amounts')
        .select('unit_id, amount')
        .eq('period_id', p.id)
      if (uaErr) throw uaErr
      if (unitAmts && unitAmts.length > 0) {
        const urows = unitAmts.map((row: { unit_id: string; amount: number }) => ({
          period_id: newId,
          unit_id: row.unit_id,
          amount: row.amount,
          updated_at: now,
        }))
        const { error: uuErr } = await supabase.from('period_unit_amounts').upsert(urows, {
          onConflict: 'period_id,unit_id',
        })
        if (uuErr) throw uuErr
      }

      const { error: syncErr } = await supabase.rpc('sync_unit_obligations_for_period', {
        p_period_id: newId,
      })
      if (syncErr) throw syncErr

      await loadPeriods()
      setSelectedPeriodId(newId)
    } catch (err: unknown) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Грешка при копиране')
    } finally {
      setCopyingPeriodId(null)
    }
  }

  const deletePeriod = async (p: BillingPeriod) => {
    if (!canEdit()) return
    if (
      !confirm(
        `Изтриване на период „${p.name}“? Ще се изтрият сумите по групи, задълженията по обекти за този период и приспаданията към тях. Записите за плащания остават, но без разпределение към този период.`
      )
    )
      return
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

      const clearedIds: string[] = []
      const overrideRows: { period_id: string; unit_id: string; amount: number; updated_at: string }[] = []
      for (const u of unitsForOverrides) {
        const raw = (unitOverrideDraft[u.id] ?? '').trim()
        const amt = raw ? parseAmount(raw) : 0
        if (!raw || amt <= 0) {
          clearedIds.push(u.id)
        } else {
          overrideRows.push({
            period_id: selectedPeriodId,
            unit_id: u.id,
            amount: amt,
            updated_at: now,
          })
        }
      }
      if (clearedIds.length > 0) {
        const { error: delErr } = await supabase
          .from('period_unit_amounts')
          .delete()
          .eq('period_id', selectedPeriodId)
          .in('unit_id', clearedIds)
        if (delErr) throw delErr
      }
      if (overrideRows.length > 0) {
        const { error: ouErr } = await supabase.from('period_unit_amounts').upsert(overrideRows, {
          onConflict: 'period_id,unit_id',
        })
        if (ouErr) throw ouErr
      }

      const { error: syncError } = await supabase.rpc('sync_unit_obligations_for_period', {
        p_period_id: selectedPeriodId,
      })
      if (syncError) throw syncError

      alert('Записано. Задълженията по обекти са синхронизирани.')
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
            По подразбиране (начин 1) задаваш сума по <strong>група обекти</strong> — всички обекти от групата ползват
            същата сума. По избор (начин 2) под таблицата можеш да зададеш <strong>индивидуална сума по конкретен
            обект</strong> за периода; тя замества тарифата по група само за този обект.
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
                        <button
                          type="button"
                          className="icon-btn"
                          title="Копирай"
                          disabled={copyingPeriodId !== null}
                          onClick={() => void copyPeriod(p)}
                        >
                          <Copy size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Редактирай"
                          disabled={copyingPeriodId !== null}
                          onClick={() => openEditPeriod(p)}
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Изтрий"
                          disabled={copyingPeriodId !== null}
                          onClick={() => void deletePeriod(p)}
                        >
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
                        <th>Сума (€)</th>
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

                {canEdit() && (
                  <details className="billing-details-override">
                    <summary className="billing-details-summary">Индивидуални суми по обект (начин 2)</summary>
                    <p className="billing-hint">
                      Празно поле = ползва се сумата по група от таблицата по-горе. Попълнена сума замества груповата
                      само за този обект. Нулева стойност се третира като без индивидуална тарифа.
                    </p>
                    {amountsLocked ? (
                      <p className="billing-hint billing-hint-warn">Периодът е затворен — без редакция.</p>
                    ) : (
                      <div className="table-wrap billing-unit-override-wrap">
                        <table className="billing-table">
                          <thead>
                            <tr>
                              <th>Обект</th>
                              <th>По група (€)</th>
                              <th>Индивидуална (€)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unitsForOverrides.map((u) => {
                              const g = groups.find((x) => x.id === u.group_id)
                              const defAmt = parseAmount(amountDraft[u.group_id] ?? '')
                              const label = g
                                ? `${compactGroupLabel(g, g.code)} ${u.number}`
                                : `${u.group?.name ?? ''} ${u.number}`
                              return (
                                <tr key={u.id}>
                                  <td>{label.trim()}</td>
                                  <td>{defAmt > 0 ? defAmt.toFixed(2) : '—'}</td>
                                  <td>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      className="billing-amount-input"
                                      disabled={savingAmounts}
                                      value={unitOverrideDraft[u.id] ?? ''}
                                      onChange={(e) =>
                                        setUnitOverrideDraft((d) => ({ ...d, [u.id]: e.target.value }))
                                      }
                                      placeholder="—"
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                )}

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
