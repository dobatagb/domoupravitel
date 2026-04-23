import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, supabaseQuery } from '../lib/supabase'
import { loadDueByUnitMap } from '../lib/buildingUnitDues'
import { useAuth } from '../contexts/AuthContext'
import { Filter, Edit2, Plus, Trash2, ChevronRight, History } from 'lucide-react'
import { format } from 'date-fns'
import bg from 'date-fns/locale/bg'
import { useUnitGroups } from '../hooks/useUnitGroups'
import { sortUnitsByTypeAndNumber } from '../lib/unitNumber'
import { unitOptionLabel } from '../lib/unitOptionLabel'
import './Obligations.css'

interface PaymentAllocationRow {
  amount: number | string
  unit_obligations: { title: string; kind: string } | null
}

interface Payment {
  id: string
  income_id: string | null
  unit_id: string
  amount: number
  payment_date: string | null
  status: string
  notes: string | null
  payment_method?: string | null
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
  payment_allocations?: PaymentAllocationRow[] | null
  units: {
    type: string
    number: string
    owner_name: string
    group?: { name: string; list_label_short: string | null; code: string } | null
  } | null
  income: {
    type: string
    description: string
    date: string
    period_start: string | null
    period_end: string | null
  } | null
}

const incomeTypeLabels: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Такса за паркоместо',
  shop_fee: 'Такса за магазин',
  other: 'Друго',
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'В брой',
  bank_transfer: 'Банков превод',
  card: 'Карта',
  other: 'Друго',
}

function descriptionLine(payment: Payment): string {
  if (payment.income) {
    const t = incomeTypeLabels[payment.income.type] ?? payment.income.type
    return `${t}: ${payment.income.description}`
  }
  const allocs = payment.payment_allocations
  if (allocs && allocs.length > 0) {
    const parts = allocs.map((a) => {
      const t = a.unit_obligations?.title ?? 'задължение'
      const amt = typeof a.amount === 'string' ? parseFloat(a.amount) : Number(a.amount)
      return `${t} ${amt.toFixed(2)} €`
    })
    return `Приспадане: ${parts.join('; ')}`
  }
  if (payment.notes?.trim()) return payment.notes.trim()
  return 'Ръчно регистрирано плащане'
}

interface UnitRow {
  id: string
  group_id: string
  type: string
  number: string
  owner_name: string
  opening_balance?: number | string | null
  group?: { name: string; code: string } | null
}

interface ObligationLine {
  id: string
  unit_id: string
  billing_period_id: string | null
  kind: 'regular' | 'extraordinary'
  title: string
  amount_original: number
  amount_remaining: number
  sort_key: number
  periodName: string | null
}

function parseMoney(raw: string): number {
  const t = raw.trim().replace(',', '.')
  if (!t) return 0
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : NaN
}

const kindLabels: Record<string, string> = {
  regular: 'Редовно',
  extraordinary: 'Извънредно',
}

export default function Obligations() {
  const { canEdit } = useAuth()
  const { labelForCode } = useUnitGroups()
  const [searchParams] = useSearchParams()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterUnit, setFilterUnit] = useState<string>('all')
  const [units, setUnits] = useState<UnitRow[]>([])
  /** Сума amount_remaining по unit_id (след миграция 015). */
  const [dueByUnit, setDueByUnit] = useState<Record<string, number>>({})
  /** Суми от unit_obligations за колоните Начислено / Остатък. */
  const [oblAggByUnit, setOblAggByUnit] = useState<Record<string, { orig: number; rem: number }>>({})
  const [maxPayForUnit, setMaxPayForUnit] = useState<number | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showCarriedDebtModal, setShowCarriedDebtModal] = useState(false)
  const [carriedDebtForm, setCarriedDebtForm] = useState({ unit_id: '', amount: '' })

  const [formData, setFormData] = useState({
    amount: '',
    payment_date: '',
    notes: '',
  })

  const [addForm, setAddForm] = useState({
    unit_id: '',
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    notes: '',
    payment_method: 'cash' as 'cash' | 'bank_transfer' | 'card' | 'other',
  })

  const [obligationLines, setObligationLines] = useState<ObligationLine[]>([])
  const [loadingObligations, setLoadingObligations] = useState(false)
  const [showObligationModal, setShowObligationModal] = useState(false)
  const [editingObligation, setEditingObligation] = useState<ObligationLine | null>(null)
  /** Сума от payment_allocations към този ред (при редакция). */
  const [obligationPaidSum, setObligationPaidSum] = useState(0)
  const [obligationForm, setObligationForm] = useState({
    title: '',
    amount_original: '',
    amount_remaining: '',
  })

  const fetchDueByUnitFromDb = async () => {
    try {
      const map = await loadDueByUnitMap()
      setDueByUnit(map)
    } catch (e) {
      console.warn('due by unit:', e)
      setDueByUnit({})
    }
  }

  const fetchOblAggByUnit = useCallback(async () => {
    const { data, error } = await supabaseQuery(() =>
      supabase.from('unit_obligations').select('unit_id, amount_original, amount_remaining')
    )
    if (error) {
      console.warn('unit_obligations aggregate:', error)
      setOblAggByUnit({})
      return
    }
    const m: Record<string, { orig: number; rem: number }> = {}
    for (const raw of data || []) {
      const r = raw as { unit_id: string; amount_original: number | string; amount_remaining: number | string }
      const o = typeof r.amount_original === 'string' ? parseFloat(r.amount_original) : Number(r.amount_original)
      const rem = typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining)
      if (!m[r.unit_id]) m[r.unit_id] = { orig: 0, rem: 0 }
      m[r.unit_id].orig += Number.isFinite(o) ? o : 0
      m[r.unit_id].rem += Number.isFinite(rem) ? rem : 0
    }
    setOblAggByUnit(m)
  }, [])

  const fetchObligationLines = useCallback(async () => {
    if (!canEdit()) return
    setLoadingObligations(true)
    try {
      const { data: rows, error } = await supabaseQuery(() =>
        supabase.from('unit_obligations').select('*').order('sort_key', { ascending: true }).order('created_at', {
          ascending: true,
        })
      )
      if (error) throw error
      const list = (rows || []) as Array<{
        id: string
        unit_id: string
        billing_period_id: string | null
        kind: 'regular' | 'extraordinary'
        title: string
        amount_original: number | string
        amount_remaining: number | string
        sort_key: number
      }>
      const periodIds = [...new Set(list.map((r) => r.billing_period_id).filter(Boolean))] as string[]
      const periodNameMap: Record<string, string> = {}
      if (periodIds.length > 0) {
        const { data: periods } = await supabase.from('billing_periods').select('id, name').in('id', periodIds)
        for (const p of periods || []) {
          const r = p as { id: string; name: string }
          periodNameMap[r.id] = r.name
        }
      }
      const enriched: ObligationLine[] = list.map((r) => ({
        id: r.id,
        unit_id: r.unit_id,
        billing_period_id: r.billing_period_id,
        kind: r.kind,
        title: r.title,
        amount_original: typeof r.amount_original === 'string' ? parseFloat(r.amount_original) : Number(r.amount_original),
        amount_remaining: typeof r.amount_remaining === 'string' ? parseFloat(r.amount_remaining) : Number(r.amount_remaining),
        sort_key: r.sort_key,
        periodName: r.billing_period_id ? periodNameMap[r.billing_period_id] ?? null : null,
      }))
      setObligationLines(enriched)
    } catch (e) {
      console.error('obligation lines:', e)
    } finally {
      setLoadingObligations(false)
    }
  }, [canEdit])

  useEffect(() => {
    fetchPayments()
    fetchUnits()
    void fetchDueByUnitFromDb()
  }, [])

  useEffect(() => {
    void fetchOblAggByUnit()
  }, [fetchOblAggByUnit])

  useEffect(() => {
    const uid = searchParams.get('unit')
    if (!uid || units.length === 0) return
    if (units.some((u) => u.id === uid)) {
      setFilterUnit(uid)
    }
  }, [searchParams, units])

  useEffect(() => {
    void fetchObligationLines()
  }, [fetchObligationLines])

  const fetchPayments = async () => {
    setLoadError(null)
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('payments')
          .select(`
          *,
          payment_allocations (
            amount,
            unit_obligations ( title, kind )
          ),
          units:unit_id (type, number, owner_name, group:group_id (name, list_label_short, code)),
          income:income_id (type, description, date, period_start, period_end)
        `)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setPayments((data as Payment[]) || [])
    } catch (error: unknown) {
      console.error('Error fetching payments:', error)
      const msg = 'Неуспешно зареждане на задълженията.'
      setLoadError(msg)
      setPayments([])
    } finally {
      setLoading(false)
    }
  }

  const fetchUnits = async () => {
    try {
      const { data, error } = await supabaseQuery(() =>
        supabase
          .from('units')
          .select('id, group_id, type, number, owner_name, opening_balance, group:group_id (name, code)')
          .order('type')
          .order('number')
      )
      if (error) throw error
      setUnits((data as unknown as UnitRow[]) || [])
    } catch (error) {
      console.error('Error fetching units:', error)
    }
  }

  const openAddModal = () => {
    setAddForm({
      unit_id: '',
      amount: '',
      payment_date: new Date().toISOString().split('T')[0],
      notes: '',
      payment_method: 'cash',
    })
    setMaxPayForUnit(null)
    setShowAddModal(true)
  }

  const openCarriedDebtModal = () => {
    const uid = filterUnit !== 'all' ? filterUnit : ''
    const u = uid ? units.find((x) => x.id === uid) : undefined
    const ob = u?.opening_balance
    setCarriedDebtForm({
      unit_id: uid,
      amount:
        ob != null && ob !== ''
          ? String(typeof ob === 'string' ? ob.replace(',', '.') : ob)
          : '',
    })
    setShowCarriedDebtModal(true)
  }

  const handleSaveCarriedDebt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const amt = parseMoney(carriedDebtForm.amount)
    if (Number.isNaN(amt) || amt < 0) {
      alert('Въведи сума ≥ 0.')
      return
    }
    if (!carriedDebtForm.unit_id) {
      alert('Избери обект.')
      return
    }
    try {
      const { error } = await supabase
        .from('units')
        .update({ opening_balance: amt })
        .eq('id', carriedDebtForm.unit_id)
      if (error) throw error
      setShowCarriedDebtModal(false)
      await fetchUnits()
      await fetchDueByUnitFromDb()
      await fetchOblAggByUnit()
      await fetchObligationLines()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при запис')
    }
  }

  useEffect(() => {
    if (!addForm.unit_id) {
      setMaxPayForUnit(null)
      return
    }
    void (async () => {
      const { data, error } = await supabaseQuery(() =>
        supabase.rpc('unit_total_due', { p_unit_id: addForm.unit_id })
      )
      if (error) {
        setMaxPayForUnit(null)
        return
      }
      const n = data != null ? Number(data) : 0
      setMaxPayForUnit(Number.isFinite(n) ? n : null)
    })()
  }, [addForm.unit_id, showAddModal])

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.unit_id || !addForm.amount || !addForm.payment_date) {
      alert('Попълни обект, сума и дата на плащане.')
      return
    }
    const amount = parseFloat(addForm.amount.replace(',', '.'))
    if (Number.isNaN(amount) || amount <= 0) {
      alert('Въведи валидна сума.')
      return
    }
    if (maxPayForUnit != null) {
      if (maxPayForUnit <= 0) {
        alert('Няма дължими суми за този обект.')
        return
      }
      if (amount > maxPayForUnit + 0.005) {
        alert(`Сумата надвишава дължимото. Максимално: ${maxPayForUnit.toFixed(2)} €.`)
        return
      }
    }
    try {
      const { error } = await supabaseQuery(() =>
        supabase.rpc('register_payment', {
          p_unit_id: addForm.unit_id,
          p_amount: amount,
          p_payment_date: addForm.payment_date,
          p_notes: addForm.notes.trim() || null,
          p_payment_method: addForm.payment_method || null,
        })
      )
      if (error) throw error
      setShowAddModal(false)
      await fetchPayments()
      await fetchDueByUnitFromDb()
      await fetchOblAggByUnit()
      await fetchObligationLines()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при запис'
      alert(
        msg.includes('null value') || msg.includes('column') || msg.includes('function')
          ? `${msg}\n\nИзпълни миграцията database_migrations/015_unit_obligations_payment_allocations.sql в Supabase SQL Editor.`
          : msg
      )
    }
  }

  const handleUpdatePayment = async () => {
    if (!editingPayment) return
    if (!editingPayment.income_id) {
      alert('Плащанията с автоматично приспадане не се редактират оттук — изтрий записа и въведи наново при нужда.')
      return
    }
    const amount = parseFloat(formData.amount.replace(',', '.'))
    if (Number.isNaN(amount) || amount <= 0) {
      alert('Въведи валидна сума.')
      return
    }
    try {
      const { error } = await supabase
        .from('payments')
        .update({
          amount,
          payment_date: formData.payment_date || null,
          notes: formData.notes.trim() || null,
        })
        .eq('id', editingPayment.id)

      if (error) throw error

      setShowModal(false)
      setEditingPayment(null)
      void fetchPayments()
      void fetchObligationLines()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Грешка при обновяване'
      alert(msg)
    }
  }

  const handleDeletePayment = async (payment: Payment) => {
    if (!canEdit()) return
    const u = payment.units
    const label = u
      ? `${u.group?.name ?? labelForCode(u.type)} ${u.number} — ${payment.amount.toFixed(2)} €`
      : 'това плащане'
    if (!confirm(`Изтриване на плащане: ${label}?\n\nДействието не може да се отмени.`)) {
      return
    }
    try {
      // Винаги RPC: при директен DELETE плащанията CASCADE махат payment_allocations, но не
      // възстановяват amount_remaining в unit_obligations (проблем при плащания „от приход“).
      const { error } = await supabaseQuery(() =>
        supabase.rpc('delete_payment_with_restore', { p_payment_id: payment.id })
      )
      if (error) throw error
      await fetchPayments()
      await fetchDueByUnitFromDb()
      await fetchOblAggByUnit()
      await fetchObligationLines()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при изтриване'
      alert(msg)
    }
  }

  const openEditObligationModal = async (row: ObligationLine) => {
    setEditingObligation(row)
    setObligationForm({
      title: row.title,
      amount_original: String(row.amount_original),
      amount_remaining: String(row.amount_remaining),
    })
    let paid = 0
    try {
      const { data: allocs, error } = await supabase.from('payment_allocations').select('amount').eq('unit_obligation_id', row.id)
      if (error) throw error
      for (const a of allocs || []) {
        paid += Number((a as { amount: number | string }).amount) || 0
      }
    } catch (e) {
      console.error(e)
      paid = 0
    }
    setObligationPaidSum(Math.round(paid * 100) / 100)
    setShowObligationModal(true)
  }

  const saveObligationLine = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingObligation || !canEdit()) return
    const title = obligationForm.title.trim()
    if (!title) {
      alert('Въведи заглавие.')
      return
    }
    const ao = parseMoney(obligationForm.amount_original)
    if (Number.isNaN(ao) || ao < 0) {
      alert('Оригиналната сума трябва да е число ≥ 0.')
      return
    }
    const paid = obligationPaidSum
    let ar: number
    if (paid > 0.005) {
      ar = Math.round(Math.max(0, ao - paid) * 100) / 100
      if (ao < paid - 0.005) {
        alert(`Оригиналната сума не може да е по-малка от вече приспаданото (${paid.toFixed(2)} €).`)
        return
      }
    } else {
      ar = parseMoney(obligationForm.amount_remaining)
      if (Number.isNaN(ar) || ar < 0) {
        alert('Остатъкът трябва да е число ≥ 0.')
        return
      }
      if (ar > ao + 0.005) {
        alert('Остатъкът не може да надвишава оригиналната сума.')
        return
      }
    }
    try {
      const { error } = await supabase
        .from('unit_obligations')
        .update({
          title,
          amount_original: ao,
          amount_remaining: ar,
        })
        .eq('id', editingObligation.id)
      if (error) throw error
      if (editingObligation.billing_period_id === null && title === 'Пренесен дълг') {
        const { error: uErr } = await supabase
          .from('units')
          .update({ opening_balance: ao })
          .eq('id', editingObligation.unit_id)
        if (uErr) console.warn('sync units.opening_balance:', uErr)
      }
      setShowObligationModal(false)
      setEditingObligation(null)
      await fetchUnits()
      await fetchObligationLines()
      await fetchDueByUnitFromDb()
      await fetchOblAggByUnit()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при запис')
    }
  }

  const deleteObligationLine = async (row: ObligationLine) => {
    if (!canEdit()) return
    /** Броим приспаданията директно в базата преди изтриване. */
    let allocNow = 0
    try {
      const { count, error: cErr } = await supabase
        .from('payment_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('unit_obligation_id', row.id)
      if (cErr) throw cErr
      allocNow = count ?? 0
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Грешка при проверка на приспаданията.')
      return
    }

    if (allocNow > 0) {
      try {
        const { data: allocs, error: aErr } = await supabase
          .from('payment_allocations')
          .select('amount, payment_id, payments ( id, payment_date, amount, income_id )')
          .eq('unit_obligation_id', row.id)
        if (aErr) throw aErr
        const parts: string[] = []
        for (const raw of allocs || []) {
          const a = raw as {
            amount: number | string
            payment_id: string
            payments:
              | { id: string; payment_date: string | null; amount: number | string; income_id: string | null }
              | { id: string; payment_date: string | null; amount: number | string; income_id: string | null }[]
              | null
          }
          let p = a.payments
          if (Array.isArray(p)) p = p[0] ?? null
          if (!p) continue
          const pamt = typeof p.amount === 'string' ? parseFloat(p.amount) : Number(p.amount)
          const al = typeof a.amount === 'string' ? parseFloat(a.amount) : Number(a.amount)
          const d = p.payment_date
            ? format(new Date(p.payment_date), 'dd.MM.yyyy', { locale: bg })
            : '—'
          const fromIncome = p.income_id ? ' (от приход)' : ''
          parts.push(
            `• ${d} — плащане общо ${Number.isFinite(pamt) ? pamt.toFixed(2) : '?'} €${fromIncome}, приспадане към този ред: ${Number.isFinite(al) ? al.toFixed(2) : '?'} € (id: ${p.id.slice(0, 8)}…)`,
          )
        }
        const detail =
          parts.length > 0
            ? `\n\nСвързани приспадания:\n${parts.join('\n')}\n`
            : `\n\nВ базата има още ${allocNow} приспадане(я), но детайлите не се показаха (напр. липсващо плащане). Опресни страницата (F5) и опитай отново, или провери в Supabase таблица payment_allocations.\n`
        alert(
          `Не може да се изтрие задължението „${row.title}“, докато има приспадания към него.${detail}\nКакво да направиш:\n1) Превърти надолу до списъка „Плащания“ (или филтрирай по същия обект).\n2) Намери тези плащания и ги изтрий — за плащания от «Задължения» се възстановяват задълженията автоматично.\n3) Плащания, вързани с приход („от приход“), се трият оттук само ако позволява системата; при нужда коригирай в «Финанси».\n\nСлед това опитай изтриване на реда отново.`,
        )
      } catch (e: unknown) {
        alert(
          e instanceof Error
            ? e.message
            : 'Този ред има приспадания от плащания. Първо изтрий свързаните плащания от списъка по-долу (с възстановяване на задълженията), после опитай отново.',
        )
      }
      return
    }
    if (
      !confirm(
        `Изтриване на задължение „${row.title}“?\n\nТова не може да се отмени. Редовните редове от период може да се възстановят при „Запази суми“ в Периоди.`
      )
    ) {
      return
    }
    try {
      const { error } = await supabase.from('unit_obligations').delete().eq('id', row.id)
      if (error) throw error
      if (row.billing_period_id === null && row.title === 'Пренесен дълг') {
        const { error: uErr } = await supabase.from('units').update({ opening_balance: 0 }).eq('id', row.unit_id)
        if (uErr) console.warn('clear units.opening_balance:', uErr)
      }
      await fetchUnits()
      await fetchObligationLines()
      await fetchDueByUnitFromDb()
      await fetchOblAggByUnit()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Грешка при изтриване')
    }
  }

  const openEditModal = (payment: Payment) => {
    setEditingPayment(payment)
    setFormData({
      amount: String(payment.amount),
      payment_date: payment.payment_date ? payment.payment_date.slice(0, 10) : '',
      notes: payment.notes || '',
    })
    setShowModal(true)
  }

  const filteredPayments = payments.filter((payment) => {
    if (filterUnit !== 'all' && payment.unit_id !== filterUnit) return false
    return true
  })

  const filteredObligationLines = obligationLines.filter(
    (o) => filterUnit === 'all' || o.unit_id === filterUnit
  )

  const paidByUnit = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of payments) {
      if (p.status !== 'paid') continue
      const amt = typeof p.amount === 'string' ? parseFloat(p.amount) : Number(p.amount)
      if (!Number.isFinite(amt)) continue
      m[p.unit_id] = (m[p.unit_id] ?? 0) + amt
    }
    return m
  }, [payments])

  const stats = {
    total: filteredPayments.reduce((sum, p) => sum + p.amount, 0),
    count: filteredPayments.length,
  }

  const unitSummaryRows = (() => {
    const list =
      filterUnit === 'all' ? units : units.filter((u) => u.id === filterUnit)
    return [...list]
      .sort((a, b) => {
        const ga = a.group?.name ?? labelForCode(a.type)
        const gb = b.group?.name ?? labelForCode(b.type)
        const c = ga.localeCompare(gb, 'bg')
        return c !== 0 ? c : a.number.localeCompare(b.number, 'bg', { numeric: true })
      })
      .map((u) => {
        const agg = oblAggByUnit[u.id]
        const totalDue = dueByUnit[u.id] ?? agg?.rem ?? 0
        const totalOrig = agg?.orig ?? 0
        const totalRem = agg?.rem ?? totalDue
        const paid = paidByUnit[u.id] ?? 0
        return { unit: u, totalDue, totalOrig, totalRem, paid }
      })
  })()

  if (loading) {
    return <div>Зареждане...</div>
  }

  return (
    <div className="obligations-page">
      {loadError && (
        <div className="load-error-banner" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setLoading(true)
              void fetchPayments()
              void fetchDueByUnitFromDb()
              void fetchOblAggByUnit()
              void fetchObligationLines()
            }}
          >
            Опитай отново
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>Задължения</h1>
          <p>
            Неплатените суми идват от редове в „Задължения“ в базата (периоди по група + пренесен дълг). Пренесеният дълг се
            задава с бутона по-долу — влиза като ред „Пренесен дълг“ и се включва в неплатеното. При плащане сумата се приспада
            автоматично: първо извънредните (най-старите), после редовните (най-старите). Не се допуска плащане над остатъка.
          </p>
        </div>
        <div className="page-header-actions obligations-header-actions">
          {canEdit() && (
            <>
              <button type="button" className="btn-secondary" onClick={openCarriedDebtModal}>
                <History size={20} />
                Пренесен дълг по обект
              </button>
              <button type="button" className="btn-primary" onClick={openAddModal}>
                <Plus size={20} />
                Ново плащане
              </button>
            </>
          )}
        </div>
      </div>

      <div className="stats-cards obligations-stats-simple">
        <div className="stat-card">
          <div className="stat-label">Обща сума (показани)</div>
          <div className="stat-value">{stats.total.toFixed(2)} €</div>
        </div>
        <div className="stat-card paid">
          <div className="stat-label">Брой плащания</div>
          <div className="stat-value">{stats.count}</div>
        </div>
      </div>

      <div className="obligations-period-panel">
        {units.length > 0 && unitSummaryRows.length > 0 && (
          <div className="obligations-unit-summary">
            <h2 className="obligations-summary-heading">Обобщение по обекти</h2>
            <div className="table-wrap obligations-summary-table-wrap">
              <table className="obligations-summary-table">
                <thead>
                  <tr>
                    <th>Обект</th>
                    <th>Група</th>
                    <th className="num" title="Сума от начислените задължения (лица на редовете)">
                      Дължи (начислено)
                    </th>
                    <th className="num" title="Сума от записите със статус „платено“">
                      Платено
                    </th>
                    <th className="num" title="Текущо неплатено (остатък по редове)">
                      Остатък
                    </th>
                    <th>Детайл</th>
                  </tr>
                </thead>
                <tbody>
                  {unitSummaryRows.map(({ unit: u, totalOrig, totalRem, paid }) => (
                    <tr key={u.id}>
                      <td>
                        <strong>
                          {u.group?.name ?? labelForCode(u.type)} {u.number}
                        </strong>
                        <div className="unit-owner">{u.owner_name}</div>
                      </td>
                      <td>{u.group?.name ?? '—'}</td>
                      <td className="num">{totalOrig.toFixed(2)} €</td>
                      <td className="num">{paid.toFixed(2)} €</td>
                      <td className="num">
                        <span className={totalRem > 0.009 ? 'balance-owed' : 'balance-ok'}>{totalRem.toFixed(2)} €</span>
                      </td>
                      <td>
                        <Link
                          to={`/obligations?unit=${u.id}`}
                          className="obligations-summary-detail-link"
                          onClick={() => setFilterUnit(u.id)}
                        >
                          Плащания
                          <ChevronRight size={16} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="obligations-period-hint">
              <strong>Дължи</strong> — сума на начислените задължения; <strong>Платено</strong> — сума от плащанията със статус
              „платено“; <strong>Остатък</strong> — текущо неплатено по редовете. Връзката „Плащания“ задава филтъра по обект
              към списъка по-долу.
            </p>
          </div>
        )}
        {units.length === 0 && (
          <p className="obligations-period-empty">Няма регистрирани обекти.</p>
        )}
        {units.length > 0 && unitSummaryRows.length === 0 && (
          <p className="obligations-period-empty">
            Няма обекти за показване — провери филтъра „Всички обекти“ по-долу.
          </p>
        )}
      </div>

      <div className="filter-section" id="obligations-filter-anchor">
        <div className="filter-group">
          <Filter size={18} />
          <select
            value={filterUnit}
            onChange={(e) => setFilterUnit(e.target.value)}
            className="filter-select"
          >
            <option value="all">Всички обекти</option>
            {sortUnitsByTypeAndNumber(units).map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unitOptionLabel(
                  { groupName: unit.group?.name ?? null, typeCode: unit.type, number: String(unit.number) },
                  labelForCode
                )}
              </option>
            ))}
          </select>
        </div>
        <div className="payments-count">
          Показване: {filteredPayments.length} от {payments.length} записа
        </div>
      </div>

      {canEdit() && (
        <div className="obligations-lines-panel">
          <h2 className="obligations-lines-heading">Редове задължения по обекти</h2>
          <p className="obligations-lines-hint">
            Редът „Пренесен дълг“ (без период) следва сумата от „Пренесен дълг по обект“; редакция тук обновява и полето в
            обекта. Редакция на други редове; изтриване само ако няма приспадания от плащания. Редовните тарифи от период при
            следващо „Запази суми“ в <strong>Периоди</strong> могат да се презапишат от синхронизацията.
          </p>
          {loadingObligations ? (
            <p className="obligations-period-empty">Зареждане на редове…</p>
          ) : filteredObligationLines.length === 0 ? (
            <p className="obligations-period-empty">Няма редове за избрания филтър.</p>
          ) : (
            <div className="table-wrap obligations-obl-table-wrap">
              <table className="obligations-obl-table">
                <thead>
                  <tr>
                    <th>Обект</th>
                    <th>Период</th>
                    <th>Вид</th>
                    <th>Заглавие</th>
                    <th className="num">Оригинал</th>
                    <th className="num">Остатък</th>
                    {canEdit() && <th>Действия</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredObligationLines.map((row) => {
                    const u = units.find((x) => x.id === row.unit_id)
                    const unitLabel = u ? `${u.group?.name ?? labelForCode(u.type)} ${u.number}`.trim() : '—'
                    const periodCell = row.periodName ?? (row.billing_period_id ? '—' : 'без период')
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{unitLabel}</strong>
                          {u && <div className="unit-owner">{u.owner_name}</div>}
                        </td>
                        <td>{periodCell}</td>
                        <td>{kindLabels[row.kind] ?? row.kind}</td>
                        <td>{row.title}</td>
                        <td className="num">{row.amount_original.toFixed(2)} €</td>
                        <td className="num">{row.amount_remaining.toFixed(2)} €</td>
                        {canEdit() && (
                          <td>
                            <div className="payment-row-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                title="Редактирай"
                                onClick={() => void openEditObligationModal(row)}
                              >
                                <Edit2 size={18} />
                              </button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                title="Изтрий"
                                onClick={() => void deleteObligationLine(row)}
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
          )}
        </div>
      )}

      <div className="payments-table">
        {filteredPayments.length === 0 ? (
          <div className="empty-state">Няма записи</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Обект</th>
                <th>Описание</th>
                <th>Сума</th>
                <th>Дата на плащане</th>
                {canEdit() && <th>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((payment) => {
                const u = payment.units
                return (
                  <tr key={payment.id} className="payment-row">
                    <td>
                      <div className="unit-info">
                        <strong>
                          {u ? `${u.group?.name ?? labelForCode(u.type)} ${u.number}` : '—'}
                        </strong>
                        <div className="unit-owner">{u?.owner_name ?? ''}</div>
                      </div>
                    </td>
                    <td>
                      <div className="income-description">{descriptionLine(payment)}</div>
                      {payment.payment_method && paymentMethodLabels[payment.payment_method] && (
                        <div className="payment-method-tag">{paymentMethodLabels[payment.payment_method]}</div>
                      )}
                    </td>
                    <td>
                      <strong className="amount">{payment.amount.toFixed(2)} €</strong>
                    </td>
                    <td>
                      {payment.payment_date ? (
                        format(new Date(payment.payment_date), 'dd.MM.yyyy', { locale: bg })
                      ) : (
                        <span className="no-date">—</span>
                      )}
                    </td>
                    {canEdit() && (
                      <td>
                        <div className="payment-row-actions">
                          {payment.income_id && (
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => openEditModal(payment)}
                              title="Редактирай"
                            >
                              <Edit2 size={18} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => void handleDeletePayment(payment)}
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
        )}
      </div>

      {showCarriedDebtModal && (
        <div className="modal-overlay" onClick={() => setShowCarriedDebtModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Пренесен дълг (старо задължение)</h2>
            <p className="form-hint obligations-modal-hint">
              Задава се сумата, която обектът дължи извън текущото таксуване по периоди. В базата се създава или обновява ред
              „Пренесен дълг“ и влиза в неплатеното и в плащанията. Вече приспаднатото от плащания се запазва при промяна на
              общата сума.
            </p>
            <form className="obligations-modal-form" onSubmit={handleSaveCarriedDebt}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="carried-unit">Обект *</label>
                  <select
                    id="carried-unit"
                    value={carriedDebtForm.unit_id}
                    onChange={(e) => setCarriedDebtForm((f) => ({ ...f, unit_id: e.target.value }))}
                    required
                  >
                    <option value="">— Избери обект —</option>
                    {sortUnitsByTypeAndNumber(units).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unitOptionLabel(
                          { groupName: unit.group?.name ?? null, typeCode: unit.type, number: String(unit.number) },
                          labelForCode
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="carried-amt">Пренесен дълг (€) *</label>
                  <input
                    id="carried-amt"
                    type="text"
                    inputMode="decimal"
                    value={carriedDebtForm.amount}
                    onChange={(e) => setCarriedDebtForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCarriedDebtModal(false)}>
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

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Ново плащане</h2>
            <p className="form-hint obligations-modal-hint">
              Сумата се приспада автоматично по ред на задълженията (извънредни първи). Не може да надвиши неплатеното по
              обекта.
              {maxPayForUnit != null && addForm.unit_id && (
                <>
                  {' '}
                  <strong>Максимум сега: {maxPayForUnit.toFixed(2)} €</strong>
                </>
              )}
            </p>
            <form className="obligations-modal-form" onSubmit={handleCreatePayment}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="add-unit">Обект *</label>
                  <select
                    id="add-unit"
                    value={addForm.unit_id}
                    onChange={(e) => setAddForm({ ...addForm, unit_id: e.target.value })}
                    required
                  >
                    <option value="">— Избери обект —</option>
                    {sortUnitsByTypeAndNumber(units).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unitOptionLabel(
                          { groupName: unit.group?.name ?? null, typeCode: unit.type, number: String(unit.number) },
                          labelForCode
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="add-amount">Сума (€) *</label>
                  <input
                    id="add-amount"
                    type="text"
                    inputMode="decimal"
                    value={addForm.amount}
                    onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="add-payment-date">Дата на плащане *</label>
                  <input
                    id="add-payment-date"
                    type="date"
                    value={addForm.payment_date}
                    onChange={(e) => setAddForm({ ...addForm, payment_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="add-method">Начин на плащане</label>
                  <select
                    id="add-method"
                    value={addForm.payment_method}
                    onChange={(e) =>
                      setAddForm({
                        ...addForm,
                        payment_method: e.target.value as typeof addForm.payment_method,
                      })
                    }
                  >
                    <option value="cash">В брой</option>
                    <option value="bank_transfer">Банков превод</option>
                    <option value="card">Карта</option>
                    <option value="other">Друго</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="add-notes">Бележки / пояснение</label>
                  <textarea
                    id="add-notes"
                    value={addForm.notes}
                    onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                    rows={2}
                    placeholder="По желание"
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Отказ
                </button>
                <button type="submit" className="btn-primary">
                  Запиши плащане
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showObligationModal && editingObligation && (
        <div className="modal-overlay" onClick={() => setShowObligationModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Редактирай задължение</h2>
            <p className="form-hint obligations-modal-hint">
              {editingObligation.kind === 'regular' && editingObligation.billing_period_id && (
                <>
                  Редовно задължение към период — при запис на суми в „Периоди“ редът може да се синхронизира отново.{' '}
                </>
              )}
              {obligationPaidSum > 0.005 && (
                <>
                  Приспаднато от плащания: <strong>{obligationPaidSum.toFixed(2)} €</strong> — остатъкът от оригинал.
                </>
              )}
            </p>
            <form className="obligations-modal-form" onSubmit={saveObligationLine}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="obl-title">Заглавие *</label>
                  <input
                    id="obl-title"
                    value={obligationForm.title}
                    onChange={(e) => setObligationForm((f) => ({ ...f, title: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="obl-ao">Оригинална сума (€) *</label>
                  <input
                    id="obl-ao"
                    type="text"
                    inputMode="decimal"
                    value={obligationForm.amount_original}
                    onChange={(e) => setObligationForm((f) => ({ ...f, amount_original: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="obl-ar">Остатък (€) {obligationPaidSum > 0.005 ? '(автоматично)' : '*'}</label>
                  <input
                    id="obl-ar"
                    type="text"
                    inputMode="decimal"
                    value={
                      obligationPaidSum > 0.005
                        ? (() => {
                            const ao = parseMoney(obligationForm.amount_original)
                            if (Number.isNaN(ao)) return ''
                            return Math.max(0, Math.round((ao - obligationPaidSum) * 100) / 100).toFixed(2)
                          })()
                        : obligationForm.amount_remaining
                    }
                    onChange={(e) => setObligationForm((f) => ({ ...f, amount_remaining: e.target.value }))}
                    disabled={obligationPaidSum > 0.005}
                    required={obligationPaidSum <= 0.005}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowObligationModal(false)}>
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

      {showModal && editingPayment && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Редактирай плащане</h2>
            <form
              className="obligations-modal-form"
              onSubmit={(e) => {
                e.preventDefault()
                void handleUpdatePayment()
              }}
            >
              <div className="modal-body">
                <div className="form-group">
                  <label>Сума (€) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Дата на плащане</label>
                  <input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Бележки</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
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
