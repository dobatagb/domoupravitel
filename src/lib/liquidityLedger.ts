import { supabase, supabaseQuery } from './supabase'

/** Каса, сметка, фонд ремонт = от приходи/разходи/плащания (каса/банк нямат плащания към ремонт в v1). */
export type LedgerDetail = {
  cash: number
  bank: number
  repairFund: number
  parts: {
    incomeCash: number
    incomeBank: number
    incomeRepair: number
    paymentCash: number
    paymentBank: number
    expenseCash: number
    expenseBank: number
    expenseRepair: number
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

type RpcRow = {
  cash: string | number
  bank: string | number
  repair_fund?: string | number
  income_cash: string | number
  income_bank: string | number
  income_repair?: string | number
  payment_cash: string | number
  payment_bank: string | number
  expense_cash: string | number
  expense_bank: string | number
  expense_repair?: string | number
}

function mapRpcToLedger(row: RpcRow): LedgerDetail {
  return {
    cash: round2(Number(row.cash)),
    bank: round2(Number(row.bank)),
    repairFund: round2(Number(row.repair_fund ?? 0)),
    parts: {
      incomeCash: round2(Number(row.income_cash)),
      incomeBank: round2(Number(row.income_bank)),
      incomeRepair: round2(Number(row.income_repair ?? 0)),
      paymentCash: round2(Number(row.payment_cash)),
      paymentBank: round2(Number(row.payment_bank)),
      expenseCash: round2(Number(row.expense_cash)),
      expenseBank: round2(Number(row.expense_bank)),
      expenseRepair: round2(Number(row.expense_repair ?? 0)),
    },
  }
}

export async function fetchLedgerDetail(): Promise<LedgerDetail> {
  const { data, error } = await supabaseQuery(() => supabase.rpc('building_liquidity_ledger'))
  if (!error && data != null) {
    const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null | undefined
    if (row && typeof row === 'object' && 'cash' in row) {
      return mapRpcToLedger(row)
    }
  }
  if (error) {
    console.warn('building_liquidity_ledger:', error)
  }
  return fetchLedgerDetailFromClient()
}

/** Fallback: след RLS в браузъра. */
export async function fetchLedgerDetailFromClient(): Promise<LedgerDetail> {
  const [incRes, payRes, expRes] = await Promise.all([
    supabaseQuery(() => supabase.from('income').select('amount, received_to')),
    supabaseQuery(() => supabase.from('payments').select('amount, payment_method, status').eq('status', 'paid')),
    supabaseQuery(() => supabase.from('expenses').select('amount, paid_from')),
  ])
  if (incRes.error) throw incRes.error
  if (payRes.error) throw payRes.error
  if (expRes.error) throw expRes.error

  let incomeCash = 0
  let incomeBank = 0
  let incomeRepair = 0
  for (const raw of incRes.data || []) {
    const r = raw as { amount: number | string; received_to: string | null }
    const a = typeof r.amount === 'string' ? parseFloat(r.amount) : Number(r.amount)
    if (!Number.isFinite(a)) continue
    const rt = (r.received_to ?? 'cash').toString().trim().toLowerCase()
    if (rt === 'bank_transfer') incomeBank += a
    else if (rt === 'repair_fund') incomeRepair += a
    else incomeCash += a
  }

  let paymentCash = 0
  let paymentBank = 0
  for (const raw of payRes.data || []) {
    const r = raw as { amount: number | string; payment_method: string | null }
    const a = typeof r.amount === 'string' ? parseFloat(r.amount) : Number(r.amount)
    if (!Number.isFinite(a)) continue
    const m = (r.payment_method ?? '').trim().toLowerCase()
    if (m === 'cash') paymentCash += a
    else if (m === 'bank_transfer') paymentBank += a
  }

  let expenseCash = 0
  let expenseBank = 0
  let expenseRepair = 0
  for (const raw of expRes.data || []) {
    const r = raw as { amount: number | string; paid_from: string | null }
    const a = typeof r.amount === 'string' ? parseFloat(r.amount) : Number(r.amount)
    if (!Number.isFinite(a)) continue
    const pf = (r.paid_from ?? 'cash').toString().trim().toLowerCase()
    if (pf === 'bank_transfer') expenseBank += a
    else if (pf === 'repair_fund') expenseRepair += a
    else expenseCash += a
  }

  const cash = round2(incomeCash + paymentCash - expenseCash)
  const bank = round2(incomeBank + paymentBank - expenseBank)
  const repairFund = round2(incomeRepair - expenseRepair)

  return {
    cash,
    bank,
    repairFund,
    parts: {
      incomeCash: round2(incomeCash),
      incomeBank: round2(incomeBank),
      incomeRepair: round2(incomeRepair),
      paymentCash: round2(paymentCash),
      paymentBank: round2(paymentBank),
      expenseCash: round2(expenseCash),
      expenseBank: round2(expenseBank),
      expenseRepair: round2(expenseRepair),
    },
  }
}
