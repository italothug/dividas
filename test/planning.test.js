import test from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, scheduleCard, scheduleIncome, ensureMonths, debtStatement, validateDebtor } from '../src/lib/planning.js'
import { validateLedgerState } from '../src/lib/ledger.js'

const ledger = () => ({ mesesLista: ['2026-12'], mesAtual: '2026-12', dados: { '2026-12': { entradas: [], saidas: [] } } })
const card = () => ({ id: 'visa', desc: 'Visa', tipo: 'cartao', valor: 800, paga: false, detalhes: [
  { id: 'machine', desc: 'Máquina', valor: 325.17, parcelaAtual: 2, parcelaTotal: 4 },
  { id: 'repair', desc: 'Revisão', valor: 163.33, parcelaAtual: 3, parcelaTotal: 3 },
  { id: 'part', desc: 'Peça', valor: 213.01, parcelaAtual: 1, parcelaTotal: 3 },
] })
const debt = overrides => ({ id: 'a', name: 'Teste', principal: 1000, rate: 2, installment: 200, startMonth: '2026-01', dueDay: 31, payments: [], ...overrides })

test('advance payments reduce principal immediately and interest starts only at billing month', () => {
  for (const paymentMode of ['fixed', 'flexible']) {
    const d=debt({paymentMode,rate:10,startMonth:'2026-12',payments:[{id:'p',date:'2026-10-16',amount:200}]})
    const current=debtStatement(d,'2026-10')
    assert.equal(current.balance,800)
    assert.equal(current.totalPaid,200)
    assert.equal(current.totalInterest,0)
    assert.equal(current.rows[0].status,'Antecipado')
    assert.equal(current.rows[0].expected,null)
    assert.equal(current.nextInterest,80)
    assert.equal(debtStatement(d,'2026-11').balance,800)
    assert.equal(debtStatement(d,'2026-12').balance,880)
  }
})
test('multiple advance payments, early payoff, removal and overpayment validation', () => {
  const d=debt({startMonth:'2027-01',payments:[{id:'a',date:'2026-10-01',amount:300},{id:'b',date:'2026-11-01',amount:700}]})
  assert.equal(debtStatement(d,'2026-10').balance,700)
  assert.equal(debtStatement(d,'2026-11').balance,0)
  assert.equal(debtStatement(d,'2027-02').totalInterest,0)
  assert.equal(debtStatement({...d,payments:d.payments.slice(0,1)},'2027-01').balance,714)
  assert.throws(()=>debtStatement({...d,payments:[{id:'bad',date:'2026-10-01',amount:1001}]},'2026-10'),/ultrapassa/)
})
test('backups accept advance payments and reject impossible dates', () => {
  const d=debt({startMonth:'2027-01',payments:[{id:'p',date:'2026-01-02',amount:100}]})
  assert.equal(validateLedgerState({...ledger(),devedores:[d]}).valid,true)
  assert.equal(validateDebtor({...d,payments:[{id:'p',date:'2026-02-30',amount:100}]}),false)
})

test('automatic card months carry fixed bills and unfinished debts exactly once', () => {
  const base=ledger()
  base.dados['2026-12'].saidas=[
    {id:'rent',desc:'Aluguel',tipo:'fixa',valor:500,paga:true},
    {id:'loan',desc:'Dívida',tipo:'divida',valor:100,paga:true,parcelaAtual:2,parcelaTotal:3},
  ]
  const result=scheduleCard(base,'2026-12',card())
  assert.equal(result.dados['2027-01'].saidas.find(i=>i.origemId==='loan').parcelaAtual,3)
  assert.equal(result.dados['2027-02'].saidas.some(i=>i.origemId==='loan'),false)
  assert.equal(result.dados['2027-02'].saidas.find(i=>i.origemId==='rent').paga,false)
  const repeated=ensureMonths(result,'2026-12','2027-02')
  assert.deepEqual(repeated.dados,result.dados)
})
test('debtor income installments carry pending status and stop at final installment', () => {
  const result=scheduleIncome(ledger(),'2026-12',{id:'in',desc:'Devedor',tipo:'devem',valor:125.33,recebida:true,parcelaAtual:2,parcelaTotal:4})
  assert.equal(result.dados['2027-01'].entradas[0].parcelaAtual,3)
  assert.equal(result.dados['2027-01'].entradas[0].recebida,false)
  assert.equal(result.dados['2027-02'].entradas[0].valor,125.33)
  const next=ensureMonths(result,'2027-02','2027-03')
  assert.equal(next.dados['2027-03'].entradas.length,0)
  assert.throws(()=>scheduleIncome(ledger(),'2026-12',{parcelaAtual:4,parcelaTotal:3}))
})
test('already-created card months receive missing recurring bills without overwriting payments', () => {
  const base=ledger()
  base.dados['2026-12'].saidas=[{id:'rent',desc:'Aluguel',tipo:'fixa',valor:500}]
  base.mesesLista.push('2027-01')
  base.dados['2027-01']={entradas:[],saidas:[{id:'paid',origemId:'rent',desc:'Aluguel',tipo:'fixa',valor:550,paga:true}]}
  const result=ensureMonths(base,'2026-12','2027-02')
  assert.equal(result.dados['2027-01'].saidas.length,1)
  assert.equal(result.dados['2027-01'].saidas[0].paga,true)
  assert.equal(result.dados['2027-02'].saidas[0].valor,550)
})
test('flexible payments reduce balance and next monthly interest without fixed installment', () => {
  const result=debtStatement(debt({paymentMode:'flexible',installment:null,rate:10,payments:[{id:'p',date:'2026-01-15',amount:200}]}),'2026-01')
  assert.equal(result.balance,900)
  assert.equal(result.nextInterest,90)
  assert.equal(result.nextPayment,null)
  assert.equal(result.monthsLeft,null)
  assert.equal(result.rows[0].status,'Recebido')
  assert.equal(result.rows[0].expected,null)
})
test('future billing starts only in selected month, fixed and flexible', () => {
  for(const paymentMode of ['fixed','flexible']){
    const d=debt({startMonth:'2027-01',paymentMode})
    const before=debtStatement(d,'2026-12')
    assert.equal(before.balance,1000)
    assert.equal(before.totalInterest,0)
    assert.deepEqual(before.rows,[])
    assert.equal(before.nextMonth,'2027-01')
    assert.equal(before.scheduled,true)
    assert.equal(debtStatement(d,'2027-01').balance,1020)
  }
})

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
  assert.equal(state.dados['2027-02'].saidas.length, 1)
  assert.equal(state.dados['2027-02'].saidas[0].tipo, 'fixa')
  assert.equal(state.dados['2027-02'].saidas[0].valor, 900)
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
