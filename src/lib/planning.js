export const cents = value => Math.round(value * 100)
export const monthOf = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
export function addMonths(key, count = 1) {
  const [year, month] = key.split('-').map(Number)
  return monthOf(new Date(year, month - 1 + count, 1))
}
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
export function validInstallments(item) {
  const current = item.parcelaAtual ?? 1
  const total = item.parcelaTotal ?? 1
  return Number.isInteger(current) && Number.isInteger(total) && current >= 1 && total >= current && total <= 120
}

// Rebuild only unpaid future occurrences of this card's structured purchases.
// Paid invoices are immutable here, and unrelated purchases are preserved.
export function scheduleCard(state, key, card, previous = null, makeId = () => crypto.randomUUID()) {
  card = { ...card, detalhes: card.detalhes || [] }
  if (!card.detalhes.every(validInstallments)) throw new Error('Use parcelas entre 1 e 120; a atual não pode superar o total.')
  const origin = card.origemId || card.id
  const details = card.detalhes.map(d => ({ ...d, origemId: d.origemId || d.id }))
  const source = { ...card, origemId: origin, detalhes: details, parcelaAtual: 1, parcelaTotal: 1 }
  const dados = { ...state.dados, [key]: { ...state.dados[key] } }
  const ids = new Set([...(previous?.detalhes || []), ...details].map(d => d.origemId || d.id))
  for (const month of state.mesesLista.filter(m => m > key)) {
    dados[month] = { ...dados[month], saidas: dados[month].saidas.flatMap(row => {
      if (row.tipo !== 'cartao' || (row.origemId || row.id) !== origin || row.paga) return [row]
      const removed = (row.detalhes || []).filter(d => d.automatic && ids.has(d.origemId || d.id))
      if (!removed.length) return [row]
      const remaining = row.detalhes.filter(d => !removed.includes(d))
      const value = cents(row.valor) - removed.reduce((sum, d) => sum + cents(d.valor), 0)
      return value <= 0 && !remaining.length ? [] : [{ ...row, valor: Math.max(1, value) / 100, detalhes: remaining }]
    }) }
  }
  dados[key].saidas = previous
    ? dados[key].saidas.map(row => row.id === previous.id ? source : row)
    : [...dados[key].saidas, source]
  for (const detail of details) {
    for (let offset = 1; offset <= (detail.parcelaTotal || 1) - (detail.parcelaAtual || 1); offset++) {
      const month = addMonths(key, offset)
      const existing = dados[month] || { entradas: [], saidas: [] }
      const row = existing.saidas.find(s => s.tipo === 'cartao' && (s.origemId || s.id) === origin)
      if (row?.paga) continue
      const nextDetail = { ...detail, id: makeId(), automatic: true, parcelaAtual: (detail.parcelaAtual || 1) + offset }
      const nextRow = row
        ? { ...row, valor: (cents(row.valor) + cents(detail.valor)) / 100, detalhes: [...(row.detalhes || []), nextDetail] }
        : { id: makeId(), origemId: origin, desc: card.desc, tipo: 'cartao', paga: false, valor: detail.valor, parcelaAtual: 1, parcelaTotal: 1, detalhes: [nextDetail] }
      dados[month] = { ...existing, saidas: row ? existing.saidas.map(s => s.id === row.id ? nextRow : s) : [...existing.saidas, nextRow] }
    }
  }
  return { ...state, dados, mesesLista: [...new Set([...state.mesesLista, ...Object.keys(dados)])].sort() }
}

export function validateDebtor(debt) {
  if (!debt?.id || typeof debt.name !== 'string' || !debt.name.trim() || !Number.isFinite(debt.principal) || debt.principal <= 0 || debt.principal > 1e9 || !Number.isFinite(debt.rate) || debt.rate < 0 || debt.rate > 100 || !Number.isFinite(debt.installment) || debt.installment <= 0 || debt.installment > 1e9 || !validMonth(debt.startMonth) || debt.startMonth < '2000-01' || debt.startMonth > '2100-12' || !Number.isInteger(debt.dueDay) || debt.dueDay < 1 || debt.dueDay > 31 || !Array.isArray(debt.payments)) return false
  const ids = new Set()
  return debt.payments.every(p => {
    if (!p?.id || ids.has(p.id) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date)) || new Date(p.date).toISOString().slice(0, 10) !== p.date || p.date.slice(0, 7) < debt.startMonth || p.date > '2100-12-31' || !Number.isFinite(p.amount) || p.amount <= 0 || p.amount > 1e9) return false
    ids.add(p.id)
    return true
  })
}

// Monthly competence model: interest once at the opening of each cycle,
// including the first. No daily proration, fines, or implied cash receipts.
export function debtStatement(debt, through = monthOf()) {
  if (!validateDebtor(debt) || !validMonth(through)) throw new Error('Dados do devedor inválidos.')
  let balance = cents(debt.principal)
  let totalPaid = 0
  let totalInterest = 0
  const rows = []
  const end = [through, debt.startMonth, ...debt.payments.map(p => p.date.slice(0, 7))].sort().at(-1)
  let month = debt.startMonth
  for (let i = 0; month <= end && i < 1212; i++, month = addMonths(month)) {
    const opening = balance
    const interest = Math.round(opening * debt.rate / 100)
    const paid = debt.payments.filter(p => p.date.slice(0, 7) === month).reduce((sum, p) => sum + cents(p.amount), 0)
    if (paid > opening + interest) throw new Error(`O pagamento em ${month} ultrapassa o saldo disponível.`)
    const expected = Math.min(cents(debt.installment), opening + interest)
    balance = opening + interest - paid
    if (!Number.isSafeInteger(balance) || balance > 1e14) throw new Error('O saldo excede o limite de cálculo. Revise a taxa e a data inicial.')
    totalPaid += paid
    totalInterest += interest
    const [y, m] = month.split('-').map(Number)
    const dueDate = `${month}-${String(Math.min(debt.dueDay, new Date(y, m, 0).getDate())).padStart(2, '0')}`
    rows.push({ month, dueDate, opening: opening / 100, interest: interest / 100, expected: expected / 100, paid: paid / 100, balance: balance / 100, status: balance === 0 ? 'Quitado' : paid >= expected ? 'Pago' : paid > 0 ? 'Parcial' : 'Pendente' })
  }
  const nextInterest = Math.round(balance * debt.rate / 100)
  const nextPayment = Math.min(cents(debt.installment), balance + nextInterest)
  let projected = balance
  let monthsLeft = 0
  let projectedInterest = 0
  while (projected > 0 && monthsLeft < 600) {
    const interest = Math.round(projected * debt.rate / 100)
    if (cents(debt.installment) <= interest) { monthsLeft = null; break }
    projectedInterest += interest
    projected = Math.max(0, projected + interest - cents(debt.installment))
    monthsLeft++
  }
  if (projected > 0) monthsLeft = null
  return { rows, balance: balance / 100, totalPaid: totalPaid / 100, totalInterest: totalInterest / 100, nextMonth: addMonths(end), nextPayment: nextPayment / 100, nextInterest: nextInterest / 100, monthsLeft, projectedInterest: monthsLeft === null ? null : projectedInterest / 100 }
}
