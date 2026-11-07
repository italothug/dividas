import test from 'node:test'
import assert from 'node:assert/strict'
import { postponeIncome, undoPostponement, editEntries } from '../src/lib/operations.js'
import { ensureMonths, scheduleIncome } from '../src/lib/planning.js'
import { financialSummary, validateLedgerState } from '../src/lib/ledger.js'

const row = { id: 'debtor', desc: 'João', tipo: 'devem', recebida: false, valor: 200, parcelaAtual: 1, parcelaTotal: 1 }
function fixture(month = '2026-10') {
  return { mesesLista: [month], mesAtual: month, dados: { [month]: { entradas: [{ ...row }], saidas: [
    { id: 'rent', desc: 'Aluguel', tipo: 'fixa', valor: 500, paga: true },
    { id: 'loan', desc: 'Empréstimo', tipo: 'divida', valor: 100, paga: false, parcelaAtual: 1, parcelaTotal: 3 },
  ] } } }
}
test('transfer creates next month with fixed expenses and installments, without double counting income', () => {
  const initial = fixture(), before = structuredClone(initial)
  const { state } = postponeIncome(initial, '2026-10', row.id)
  assert.deepEqual(initial, before)
  assert.equal(state.dados['2026-10'].entradas.length, 0)
  assert.equal(state.dados['2026-11'].entradas[0].valor, 200)
  assert.equal(state.dados['2026-11'].saidas.length, 2)
  assert.equal(state.dados['2026-11'].saidas[0].paga, false)
  assert.equal(state.dados['2026-11'].saidas[1].parcelaAtual, 2)
  assert.equal(financialSummary(state.dados['2026-10']).pendingIncome, 0)
  assert.equal(financialSummary(state.dados['2026-11']).pendingIncome, 200)
  assert.equal(validateLedgerState(state).valid, true)
  assert.throws(() => postponeIncome(state, '2026-10', row.id))
})
test('overdue installment coexists with scheduled installment and does not spawn a second series', () => {
  const initial = fixture(); initial.dados['2026-10'].entradas = []
  const scheduled = scheduleIncome(initial, '2026-10', { ...row, parcelaTotal: 3 })
  scheduled.dados['2026-11'].entradas[0].recebida = true
  const expected = structuredClone(scheduled.dados['2026-11'].entradas[0])
  const { state } = postponeIncome(scheduled, '2026-10', row.id)
  assert.deepEqual(state.dados['2026-11'].entradas[0], expected)
  assert.equal(state.dados['2026-11'].entradas[1].parcelaAtual, 1)
  const advanced = ensureMonths(state, '2026-10', '2027-01')
  assert.equal(advanced.dados['2026-12'].entradas.length, 1)
  assert.equal(advanced.dados['2027-01'].entradas.length, 0)
  const moved = state.dados['2026-11'].entradas[1]
  const edited = editEntries(state, '2026-11', 'entradas', moved, { ...moved, valor: 150 }, 'future')
  assert.equal(edited.dados['2026-12'].entradas[0].valor, 200)
})
test('transferred intermediate installment is not regenerated when an earlier month is advanced', () => {
  const initial = fixture(); initial.dados['2026-10'].entradas = []
  const scheduled = scheduleIncome(initial, '2026-10', { ...row, parcelaTotal: 3 })
  const second = scheduled.dados['2026-11'].entradas[0]
  const { state } = postponeIncome(scheduled, '2026-11', second.id)
  const regenerated = ensureMonths(state, '2026-10', '2027-01')
  assert.equal(regenerated.dados['2026-11'].entradas.length, 0)
  assert.deepEqual(regenerated.dados['2026-12'].entradas.map(i => i.parcelaAtual), [3, 2])
})
test('can transfer again across years without incrementing installment or duplicating income', () => {
  const first = postponeIncome(fixture('2026-12'), '2026-12', row.id)
  const second = postponeIncome(first.state, '2027-01', row.id)
  assert.equal(second.state.dados['2027-01'].entradas.length, 0)
  assert.equal(second.state.dados['2027-02'].entradas[0].parcelaAtual, 1)
  assert.equal(validateLedgerState(second.state).valid, true)
})
test('received entries, other categories, duplicate destination and unsupported year are rejected', () => {
  for (const change of [{ recebida: true }, { tipo: 'salario' }, { tipo: 'extra' }]) {
    const state = fixture(); Object.assign(state.dados['2026-10'].entradas[0], change)
    assert.throws(() => postponeIncome(state, '2026-10', row.id))
  }
  const state = ensureMonths(fixture(), '2026-10', '2026-11')
  state.dados['2026-11'].entradas.push({ ...row })
  assert.throws(() => postponeIncome(state, '2026-10', row.id))
  assert.throws(() => postponeIncome(fixture('2100-12'), '2100-12', row.id))
})
test('undo restores source and keeps next-month expenses and later additions', () => {
  const { state, undo } = postponeIncome(fixture(), '2026-10', row.id)
  state.dados['2026-11'].entradas.push({ ...row, id: 'later', valor: 20 })
  const restored = undoPostponement(state, undo)
  assert.deepEqual(restored.dados['2026-10'].entradas, [row])
  assert.equal(restored.dados['2026-11'].entradas[0].id, 'later')
  assert.equal(restored.dados['2026-11'].saidas.length, 2)
  assert.equal(restored.cancellations.length, 0)
  assert.equal(validateLedgerState(restored).valid, true)
})
test('undo refuses to overwrite a payment, edit or deletion made after transfer', () => {
  for (const mutate of [s => { s.dados['2026-11'].entradas[0].recebida = true }, s => { s.dados['2026-11'].entradas[0].valor = 50 }, s => { s.dados['2026-11'].entradas = [] }, s => { delete s.dados['2026-10'] }]) {
    const { state, undo } = postponeIncome(fixture(), '2026-10', row.id)
    mutate(state)
    assert.throws(() => undoPostponement(state, undo))
  }
})
