/**
 * Текст за плащане като в «Задължения»: приход, приспадане по редове, бележки.
 */
const incomeTypeLabels: Record<string, string> = {
  entry_fee: 'Входна такса',
  parking_fee: 'Такса за паркоместо',
  shop_fee: 'Такса за магазин',
  other: 'Друго',
}

export const paymentMethodLabels: Record<string, string> = {
  cash: 'В брой',
  bank_transfer: 'Банков превод',
  card: 'Карта',
  other: 'Друго',
}

type AllocRow = {
  amount: number | string
  unit_obligations: { title: string; kind: string } | null
} | null

type IncomeRef = { type: string; description: string } | null

export type PaymentDescriptionInput = {
  income?: IncomeRef
  payment_allocations?: AllocRow[] | null
  notes: string | null
}

export function paymentDescriptionLine(p: PaymentDescriptionInput): string {
  if (p.income) {
    const t = incomeTypeLabels[p.income.type] ?? p.income.type
    return `${t}: ${p.income.description}`
  }
  const allocs = p.payment_allocations
  if (allocs && allocs.length > 0) {
    const parts = allocs
      .filter((a): a is NonNullable<AllocRow> => a != null)
      .map((a) => {
        const t = a.unit_obligations?.title ?? 'задължение'
        const amt = typeof a.amount === 'string' ? parseFloat(a.amount) : Number(a.amount)
        return `${t} ${Number.isFinite(amt) ? amt.toFixed(2) : '?'} €`
      })
    return `Приспадане: ${parts.join('; ')}`
  }
  if (p.notes?.trim()) return p.notes.trim()
  return 'Ръчно регистрирано плащане'
}

/** Ред «Задължения» + евентуално « / В брой» */
export function paymentDescriptionWithMethod(
  p: PaymentDescriptionInput,
  paymentMethod: string | null | undefined
): string {
  const line = paymentDescriptionLine(p)
  const m = paymentMethod && paymentMethodLabels[paymentMethod] ? ` / ${paymentMethodLabels[paymentMethod]}` : ''
  return `${line}${m}`
}
