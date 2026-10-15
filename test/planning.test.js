import test from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, scheduleCard, debtStatement, validateDebtor } from '../src/lib/planning.js'
import { validateLedgerState } from '../src/lib/ledger.js'

const ledger = () => ({ mesesLista: ['2026-12'], mesAtual: '2026-12', dados: { '2026-12': { entradas: [], saidas: [] } } })
const card = () => ({ id: 'visa', desc: 'Visa', tipo: 'cartao', valor: 800, paga: false, detalhes: [
  { id: 'machine', desc: 'Máquina', valor: 325.17, parcelaAtual: 2, parcelaTotal: 4 },
  { id: 'repair', desc: 'Revisão', valor: 163.33, parcelaAtual: 3, parcelaTotal: 3 },
  { id: 'part', desc: 'Peça', valor: 213.01, parcelaAtual: 1, parcelaTotal: 3 },
] })
const debt = overrides => ({ id: 'a', name: 'Teste', principal: 1000, rate: 2, installment: 200, startMonth: '2026-01', dueDay: 31, payments: [], ...overrides })

test('card: each purchase continues independently, exact cents and year rollover', () => {
  const state = scheduleCard(ledger(), '2026-12', card())
  assert.equal(addMonths('2026-12'), '2027-01')
  assert.deepEqual(state.mesesLista, ['2026-12', '2027-01', '2027-02'])
  const jan = state.dados['2027-01'].saidas[0]
  assert.equal(jan.valor, 538.18)
  assert.deepEqual(jan.detalhes.map(d => d.parcelaAtual), [3, 2])
  assert.equal(jan.detalhes.some(d => d.desc === 'Revisão'), false)
  assert.equal(state.dados['2026-12'].saidas[0].valor, 800)
  assert.equal(validateLedgerState(state).valid, true)
})
test('card: repeated saves do not duplicate and editing/removing recalculates only future unpaid purchases', () => {
  let state = scheduleCard(ledger(), '2026-12', card())
  const previous = state.dados['2026-12'].saidas[0]
  state = scheduleCard(state, '2026-12', previous, previous)
  assert.equal(state.dados['2027-01'].saidas[0].valor, 538.18)
  const revised = { ...previous, detalhes: [{ ...previous.detalhes[0], valor: 100 }] }
  state = scheduleCard(state, '2026-12', revised, previous)
  assert.equal(state.dados['2027-01'].saidas[0].valor, 100)
  assert.equal(state.dados['2027-01'].saidas[0].detalhes.length, 1)
})
test('card: paid invoices and unrelated entries are preserved', () => {
  let state = scheduleCard(ledger(), '2026-12', card())
  const january = state.dados['2027-01']
  january.saidas[0].paga = true
  const paid = structuredClone(january.saidas[0])
  january.saidas.push({ id: 'other', desc: 'Aluguel', tipo: 'fixa', valor: 900 })
  const previous = state.dados['2026-12'].saidas[0]
  state = scheduleCard(state, '2026-12', { ...previous, detalhes: [] }, previous)
  assert.deepEqual(state.dados['2027-01'].saidas[0], paid)
  assert.equal(state.dados['2027-01'].saidas[1].valor, 900)
  assert.deepEqual(state.dados['2027-02'].saidas, [])
})
test('card: editing a future invoice does not duplicate its successors', () => {
  let state = scheduleCard(ledger(), '2026-12', card())
  const january = state.dados['2027-01'].saidas[0]
  state = scheduleCard(state, '2027-01', january, january)
  assert.equal(state.dados['2027-02'].saidas[0].valor, 538.18)
  assert.equal(state.dados['2027-02'].saidas[0].detalhes.length, 2)
})
test('card: legacy unstructured details remain one-off and invalid installments reject', () => {
  const legacy = { ...card(), detalhes: [{ id: 'one', desc: 'Compra 2/4', valor: 30 }] }
  assert.equal(scheduleCard(ledger(), '2026-12', legacy).mesesLista.length, 1)
  assert.throws(() => scheduleCard(ledger(), '2026-12', { ...card(), detalhes: [{ id: 'bad', parcelaAtual: 5, parcelaTotal: 4 }] }))
})
test('debt: monthly compound interest, missed month and partial payment', () => {
  const result = debtStatement(debt({ payments: [{ id: 'p', date: '2026-02-15', amount: 100 }] }), '2026-02')
  assert.equal(result.rows[0].interest, 20)
  assert.equal(result.rows[1].interest, 20.4)
  assert.equal(result.balance, 940.4)
  assert.equal(result.rows[1].status, 'Parcial')
  assert.equal(result.rows[1].dueDate, '2026-02-28')
  assert.equal(result.nextInterest, 18.81)
  assert.equal(result.nextPayment, 200)
})
test('debt: zero interest, multiple payments, payoff and last capped payment', () => {
  const result = debtStatement(debt({ rate: 0, principal: 250, payments: [{ id: '1', date: '2026-01-10', amount: 100 }, { id: '2', date: '2026-01-20', amount: 100 }] }), '2026-01')
  assert.equal(result.balance, 50)
  assert.equal(result.rows[0].status, 'Pago')
  assert.equal(result.nextPayment, 50)
  assert.equal(result.monthsLeft, 1)
  const paid = debtStatement(debt({ rate: 0, principal: 100, payments: [{ id: '1', date: '2026-01-01', amount: 100 }] }), '2026-03')
  assert.equal(paid.balance, 0)
  assert.equal(paid.nextPayment, 0)
  assert.equal(paid.monthsLeft, 0)
})
test('debt: non-amortizing installments warn and overpayment rejects', () => {
  assert.equal(debtStatement(debt({ rate: 10, installment: 50 }), '2026-01').monthsLeft, null)
  assert.throws(() => debtStatement(debt({ payments: [{ id: '1', date: '2026-01-10', amount: 2000 }] }), '2026-01'), /ultrapassa/)
})
test('debt: invalid dates, NaN, duplicate ids, and invalid backup reject', () => {
  assert.equal(validateDebtor(debt({ rate: NaN })), false)
  assert.equal(validateDebtor(debt({ payments: [{ id: '1', date: '2026-02-30', amount: 1 }] })), false)
  assert.equal(validateLedgerState({ ...ledger(), devedores: [debt({ rate: -1 })] }).valid, false)
  assert.equal(validateLedgerState(ledger()).valid, true)
  const good = debt({ startMonth: '2026-12' })
  assert.equal(validateLedgerState({ ...ledger(), devedores: [good] }).valid, true)
  assert.equal(validateLedgerState({ ...ledger(), devedores: [good, good] }).valid, false)
})
