import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureMonths, scheduleCard } from '../src/lib/planning.js'
import { validateLedgerState } from '../src/lib/ledger.js'
import { deleteEntries } from '../src/lib/operations.js'

function fixture() {
  const base = { mesesLista: ['2026-12'], mesAtual: '2026-12', dados: { '2026-12': { entradas: [], saidas: [
    { id: 'rent', desc: 'Aluguel', tipo: 'fixa', valor: 500, paga: true },
    { id: 'debt', desc: 'Dívida', tipo: 'divida', valor: 100, paga: false, parcelaAtual: 1, parcelaTotal: 3 },
  ] } } }
  return scheduleCard(base, '2026-12', { id: 'visa', desc: 'Visa', tipo: 'cartao', valor: 800, paga: true, detalhes: [
    { id: 'machine', desc: 'Máquina', valor: 325.17, parcelaAtual: 2, parcelaTotal: 4 },
    { id: 'repair', desc: 'Revisão', valor: 163.33, parcelaAtual: 3, parcelaTotal: 3 },
    { id: 'part', desc: 'Peça', valor: 213.01, parcelaAtual: 1, parcelaTotal: 3 },
    { id: 'cash', desc: 'À vista', valor: 10 },
  ] })
}
function removeMonths(state, months) {
  const next = structuredClone(state)
  for (const month of months) delete next.dados[month]
  next.mesesLista = next.mesesLista.filter(month => !months.includes(month))
  return next
}
const invoice = (state, month) => state.dados[month].saidas.find(row => row.tipo === 'cartao' && (row.origemId || row.id) === 'visa')

test('recreated month restores card sub-installments, exact sum, fixed bills and debts', () => {
  const original = fixture()
  const missing = removeMonths(original, ['2027-01'])
  const before = structuredClone(missing)
  const restored = ensureMonths(missing, '2026-12', '2027-01')
  const card = invoice(restored, '2027-01')
  assert.ok(card, 'A fatura do cartão deve reaparecer')
  assert.equal(card.valor, 538.18)
  assert.equal(card.paga, false)
  assert.equal(card.origemId, 'visa')
  assert.deepEqual(card.detalhes.map(d => [d.desc, d.parcelaAtual, d.parcelaTotal]), [['Máquina', 3, 4], ['Peça', 2, 3]])
  assert.ok(card.detalhes.every(d => d.automatic && d.origemId && d.id !== d.origemId))
  assert.notEqual(card.id, original.dados['2026-12'].saidas.find(row => row.tipo === 'cartao').id)
  assert.equal(restored.dados['2027-01'].saidas.find(row => row.tipo === 'fixa').paga, false)
  assert.equal(restored.dados['2027-01'].saidas.find(row => row.tipo === 'divida').parcelaAtual, 2)
  assert.deepEqual(restored.dados['2027-02'], original.dados['2027-02'])
  assert.deepEqual(missing, before)
  assert.equal(validateLedgerState(restored).valid, true)
})
test('recreates consecutive months without duplicating invoices or extending completed purchases', () => {
  const restored = ensureMonths(removeMonths(fixture(), ['2027-01', '2027-02']), '2026-12', '2027-03')
  assert.deepEqual(invoice(restored, '2027-02').detalhes.map(d => d.parcelaAtual), [4, 3])
  assert.equal(invoice(restored, '2027-03'), undefined)
  assert.deepEqual(ensureMonths(restored, '2026-12', '2027-03'), restored)
  const again = ensureMonths(removeMonths(restored, ['2027-01']), '2026-12', '2027-01')
  assert.equal(again.dados['2027-01'].saidas.filter(row => row.tipo === 'cartao').length, 1)
  assert.equal(invoice(again, '2027-01').valor, 538.18)
})
test('preserves paid and edited existing invoices and deliberate removal of purchases', () => {
  const state = fixture()
  invoice(state, '2027-01').paga = true
  invoice(state, '2027-02').valor = 600
  assert.deepEqual(ensureMonths(state, '2026-12', '2027-02'), state)
  const source = invoice(state, '2026-12')
  const edited = scheduleCard(state, '2026-12', { ...source, detalhes: [] }, source)
  assert.deepEqual(invoice(edited, '2027-02').detalhes, [])
  assert.equal(invoice(edited, '2027-02').valor, 61.82)
  assert.deepEqual(ensureMonths(edited, '2026-12', '2027-02'), edited)
})
test('respects explicit invoice cancellations when a month is recreated', () => {
  const state = fixture()
  const removed = deleteEntries(state, '2027-01', 'saidas', invoice(state, '2027-01'), 'future').state
  const restored = ensureMonths(removeMonths(removed, ['2027-01', '2027-02']), '2026-12', '2027-02')
  assert.equal(invoice(restored, '2027-01'), undefined)
  assert.equal(invoice(restored, '2027-02'), undefined)
  assert.ok(restored.dados['2027-01'].saidas.some(row => row.tipo === 'fixa'))
})
test('restores multiple cards independently and keeps their future editing links', () => {
  const state = scheduleCard(fixture(), '2026-12', { id: 'master', desc: 'Master', tipo: 'cartao', valor: 100, detalhes: [
    { id: 'book', desc: 'Livro', valor: 25.50, parcelaAtual: 1, parcelaTotal: 2 },
  ] })
  const restored = ensureMonths(removeMonths(state, ['2027-01']), '2026-12', '2027-01')
  const cards = restored.dados['2027-01'].saidas.filter(row => row.tipo === 'cartao')
  assert.deepEqual(cards.map(row => row.valor), [538.18, 25.50])
  const source = invoice(restored, '2026-12')
  const revised = { ...source, detalhes: [{ ...source.detalhes[0], valor: 100 }] }
  const edited = scheduleCard(restored, '2026-12', revised, source)
  assert.equal(invoice(edited, '2027-01').valor, 100)
  assert.equal(invoice(edited, '2027-02').valor, 100)
  assert.equal(edited.dados['2027-01'].saidas.find(row => row.origemId === 'master').valor, 25.50)
})
