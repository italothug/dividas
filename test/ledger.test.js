import test from 'node:test'
import assert from 'node:assert/strict'
import { cardDetailSummary, financialSummary, parseCurrency, validateLedgerState } from '../src/lib/ledger.js'

test('interpreta valores no formato brasileiro', () => {
  assert.equal(parseCurrency('R$ 2.000,50'), 2000.5)
  assert.equal(parseCurrency('109,90'), 109.9)
  assert.equal(parseCurrency('2000.50'), 2000.5)
  assert.ok(Number.isNaN(parseCurrency('valor inválido')))
})

test('calcula e limita os detalhes do cartão', () => {
  assert.deepEqual(cardDetailSummary(2000, [{ valor: 500 }, { valor: 250.5 }]), { detailed: 750.5, remaining: 1249.5, exceeds: false })
  assert.equal(cardDetailSummary(100, [{ valor: 100.01 }]).exceeds, true)
})

test('aceita um caderno válido e recusa dados corrompidos', () => {
  const valid = { mesesLista: ['2026-08'], mesAtual: '2026-08', dados: { '2026-08': { entradas: [{ id: '1', desc: 'Salário', valor: 100 }], saidas: [] } } }
  assert.equal(validateLedgerState(valid).valid, true)
  assert.equal(validateLedgerState({ ...valid, mesAtual: 'agosto' }).valid, false)
  assert.equal(validateLedgerState({ ...valid, dados: { '2026-08': { entradas: [{ id: '1', desc: '', valor: -1 }], saidas: [] } } }).valid, false)
})

test('separa recebidos, pendentes e saldos atual e previsto', () => {
  const summary = financialSummary({
    entradas: [{ valor: 2000, recebida: true }, { valor: 500, recebida: false }],
    saidas: [{ valor: 800, paga: true }, { valor: 300, paga: false }],
  })
  assert.deepEqual(summary, {
    receivedIncome: 2000,
    pendingIncome: 500,
    paidExpenses: 800,
    pendingExpenses: 300,
    currentBalance: 1200,
    projectedBalance: 1400,
  })
})
