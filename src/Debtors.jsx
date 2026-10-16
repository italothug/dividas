import React, { useState } from 'react'
import { debtStatement, monthOf, validateDebtor } from './lib/planning'
import { parseCurrency } from './lib/ledger'

const money = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const today = () => { const d = new Date(); return `${monthOf(d)}-${String(d.getDate()).padStart(2, '0')}` }
const blank = () => ({ name: '', contact: '', notes: '', principal: '', rate: '0', paymentMode: 'fixed', installment: '', startMonth: monthOf(), dueDay: '10' })

export default function Debtors({ debts, onChange, notify }) {
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(null)
  const [payment, setPayment] = useState({ amount: '', date: today(), note: '' })
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const debt = debts.find(d => d.id === selected) || debts[0]
  let statement, calculationError = ''
  try { if (debt) statement = debtStatement(debt) } catch (e) { calculationError = e.message }
  function saveDebt(event) {
    event.preventDefault()
    const next = { ...form, id: form.id || crypto.randomUUID(), name: form.name.trim(), principal: parseCurrency(form.principal), rate: parseCurrency(form.rate), paymentMode: form.paymentMode || 'fixed', installment: form.paymentMode === 'flexible' ? null : parseCurrency(form.installment), dueDay: Number(form.dueDay), payments: form.payments || [] }
    if (!validateDebtor(next)) { setError('Confira os valores, a taxa (0 a 100% ao mês), a data inicial e o dia de vencimento.'); return }
    try { debtStatement(next) } catch (e) { setError(e.message); return }
    onChange(form.id ? debts.map(d => d.id === form.id ? next : d) : [...debts, next])
    setSelected(next.id); setForm(null); setError(''); notify('Devedor salvo.')
  }
  function addPayment(event) {
    event.preventDefault()
    const amount = parseCurrency(payment.amount)
    if (!Number.isFinite(amount) || amount <= 0 || !payment.date || payment.date > today()) { setError('Informe um valor positivo e uma data que não esteja no futuro.'); return }
    const next = { ...debt, payments: [...debt.payments, { ...payment, amount, id: crypto.randomUUID() }] }
    try { debtStatement(next) } catch (e) { setError(e.message); return }
    onChange(debts.map(d => d.id === next.id ? next : d)); setPayment({ amount: '', date: today(), note: '' }); setError(''); notify('Pagamento registrado. Saldo e previsão recalculados.')
  }
  function removeConfirmed() {
    if (confirm.kind === 'debt') { onChange(debts.filter(d => d.id !== debt.id)); setSelected(null) }
    else {
      const next = { ...debt, payments: debt.payments.filter(p => p.id !== confirm.id) }
      try { debtStatement(next) } catch(e) { setError(e.message); setConfirm(null); return }
      onChange(debts.map(d => d.id === debt.id ? next : d))
    }
    setConfirm(null); notify('Registro removido.')
  }
  return <section className="book debt-page" id="devedores">
    <div className="debt-heading"><div><h2>Devedores</h2><p>Acompanhe acordos, recebimentos e o saldo de cada pessoa.</p></div><button className="primary" onClick={() => { setForm(blank()); setError('') }}>+ Adicionar devedor</button></div>
    <details className="calculation-rules"><summary>Como os cálculos funcionam</summary><p>Juros mensais sobre o saldo que ficou do mês anterior, aplicados uma vez por mês, inclusive no primeiro mês informado. Pagamentos são descontados no mês da data registrada. Juros não pagos entram no saldo do mês seguinte (juros compostos). Pagamentos anteriores ao primeiro mês de cobrança reduzem o principal sem juros. Não há multa nem cálculo proporcional por dia.</p><p>No modo parcelado, a parcela combinada é fixa e a última é limitada ao saldo restante. No modo pagamentos livres, registre qualquer valor recebido; os próximos juros incidem sobre o saldo que sobrou, sem parcela ou prazo de quitação obrigatório. Antes do primeiro mês de cobrança, não há juros acumulados. A previsão começa no próximo mês, supondo todos os pagamentos em dia. Registre somente valores realmente recebidos. Estes pagamentos não criam entradas automaticamente no Caderno de contas, para evitar duplicidade.</p></details>
    {form && <form className="debt-form" onSubmit={saveDebt}>
      <h3>{form.id ? 'Editar acordo' : 'Novo devedor'}</h3>
      <div className="debt-fields">
        <label>Nome<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
        <label>Contato (opcional)<input maxLength={200} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })}/></label>
        <label>Valor inicial da dívida (R$)<input required inputMode="decimal" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })}/></label>
        <label>Juros mensais (%)<input required inputMode="decimal" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })}/></label>
        <label>Forma de pagamento<select value={form.paymentMode || 'fixed'} onChange={e=>setForm({...form,paymentMode:e.target.value})}><option value="fixed">Parcelado — valor mensal combinado</option><option value="flexible">Pagamentos livres — sem parcela fixa</option></select></label>
        {form.paymentMode !== 'flexible' && <label>Parcela combinada (R$)<input required inputMode="decimal" value={form.installment} onChange={e => setForm({ ...form, installment: e.target.value })}/></label>}
        <fieldset className="billing-month"><legend>Primeiro mês de cobrança</legend><select aria-label="Mês inicial de cobrança" value={form.startMonth.slice(5)} onChange={e=>setForm({...form,startMonth:form.startMonth.slice(0,4)+'-'+e.target.value})}>{['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((name,index)=><option key={name} value={String(index+1).padStart(2,'0')}>{name}</option>)}</select><select aria-label="Ano inicial de cobrança" value={form.startMonth.slice(0,4)} onChange={e=>setForm({...form,startMonth:e.target.value+form.startMonth.slice(4)})}>{Array.from({length:101},(_,i)=>2000+i).map(year=><option key={year} value={year}>{year}</option>)}</select></fieldset>
        <label>Dia de vencimento<input required type="number" min="1" max="31" value={form.dueDay} onChange={e => setForm({ ...form, dueDay: e.target.value })}/></label>
        <label>Observações<input maxLength={1000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
      </div>
      {form.id && <p>Alterar o acordo recalcula todo o histórico. Pagamentos já registrados serão preservados.</p>}
      <div className="debt-actions"><button className="primary">Salvar devedor</button><button type="button" onClick={() => { setForm(null); setError('') }}>Cancelar</button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!debts.length && <p className="empty">Nenhum devedor cadastrado. Adicione uma pessoa para começar.</p>}
    {debts.length > 0 && <label className="debtor-select">Selecionar devedor<select value={debt.id} onChange={e => { setSelected(e.target.value); setForm(null); setConfirm(null); setError(''); setPayment({ amount: '', date: today(), note: '' }) }}>{debts.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>}
    {debt && <>
      <div className="debt-heading"><div><h3>{debt.name}</h3><p>{debt.contact || 'Sem contato informado'} · {debt.rate}% ao mês · vencimento dia {debt.dueDay}</p>{debt.notes && <p>{debt.notes}</p>}</div><div className="debt-actions"><button onClick={() => { setForm({ ...debt }); setError('') }}>Editar acordo</button><button onClick={() => setConfirm({ kind: 'debt' })}>Excluir devedor</button></div></div>
      {calculationError && <p role="alert">{calculationError} Edite o acordo para revisar os valores.</p>}
      {statement && <>
        <div className="summary">
          <Metric title="Dívida inicial" value={money(debt.principal)}/><Metric title="Total recebido" value={money(statement.totalPaid)} tone="green"/><Metric title="Saldo em aberto" value={money(statement.balance)} tone="red"/>
          <Metric title="Juros acumulados" value={money(statement.totalInterest)}/><Metric title={`Parcela prevista · ${statement.nextMonth}`} value={statement.nextPayment === null ? 'Valor livre' : money(statement.nextPayment)} tone="blue"/><Metric title={`Prazo estimado a partir de ${statement.nextMonth}`} value={debt.paymentMode === 'flexible' ? 'Sem prazo fixo' : statement.monthsLeft === null ? 'Sem quitação prevista' : `${statement.monthsLeft} mês(es)`}/>
        </div>
        <p className="debt-hint">Juros previstos em {statement.nextMonth}: {money(statement.nextInterest)}. {statement.projectedInterest !== null && `Juros futuros estimados até quitar: ${money(statement.projectedInterest)}.`} {debt.paymentMode !== 'flexible' && statement.monthsLeft === null && 'A parcela não reduz a dívida ou o prazo supera 600 meses. Reveja o acordo.'}</p>
        {statement.scheduled && <p className="debt-hint">Cobrança programada para {debt.startMonth}. Os juros começarão nesse mês, sobre o saldo restante. Você já pode registrar pagamentos antecipados abaixo.</p>}
        <form className="debt-form" onSubmit={addPayment}><h3>Registrar pagamento recebido</h3><div className="debt-fields"><label>Data do pagamento<input required type="date" min="2000-01-01" max={today()} value={payment.date} onChange={e => setPayment({ ...payment, date: e.target.value })}/></label><label>Valor pago (R$)<input required inputMode="decimal" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })}/></label><label>Observação (opcional)<input maxLength={500} value={payment.note} onChange={e => setPayment({ ...payment, note: e.target.value })}/></label></div><button className="primary">Registrar pagamento</button></form>
        <h3>Evolução mensal</h3><p className="debt-hint">No modo parcelado, “Pago” indica que a parcela do mês foi coberta. Em pagamentos livres, “Recebido” indica que houve pagamento, não que a dívida foi quitada. O saldo restante continua para o próximo mês.</p>
        <div className="debt-table" tabIndex="0" role="region" aria-label="Evolução mensal com rolagem horizontal"><table><thead><tr><th>Vencimento</th><th>Saldo inicial</th><th>Juros</th><th>Parcela</th><th>Pago</th><th>Saldo final</th><th>Situação</th></tr></thead><tbody>{statement.rows.map(r => <tr key={r.month}><td>{r.dueDate.split('-').reverse().join('/')}</td><td>{money(r.opening)}</td><td>{money(r.interest)}</td><td>{r.expected === null ? 'Livre' : money(r.expected)}</td><td className="green">{money(r.paid)}</td><td>{money(r.balance)}</td><td><span className={`pill ${r.status === 'Pago' || r.status === 'Quitado' ? 'green' : 'gold'}`}>{r.status === 'Pendente' && r.dueDate < today() ? 'Atrasado' : r.status}</span></td></tr>)}</tbody></table></div>
      </>}
      <h3>Pagamentos registrados</h3>{debt.payments.length === 0 ? <p className="empty">Nenhum recebimento registrado.</p> : <ul className="payment-list">{[...debt.payments].sort((a,b) => b.date.localeCompare(a.date)).map(p => <li key={p.id}><span>{p.date.split('-').reverse().join('/')} · <strong>{money(p.amount)}</strong>{p.note && ` — ${p.note}`}</span><button onClick={() => setConfirm({ kind: 'payment', id: p.id })}>Remover</button></li>)}</ul>}
      {confirm && <div className="debt-confirm" role="alert"><p>{confirm.kind === 'debt' ? 'Excluir este devedor e todo o histórico de pagamentos?' : 'Remover este pagamento e recalcular os meses seguintes?'}</p><button onClick={removeConfirmed}>Confirmar exclusão</button><button onClick={() => setConfirm(null)}>Cancelar</button></div>}
    </>}
  </section>
}
function Metric({ title, value, tone = 'neutral' }) { return <div className={`card ${tone}`}><span>{title}</span><strong>{value}</strong></div> }
