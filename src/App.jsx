import React, { useEffect, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, LogIn, LogOut, Plus, Trash2, Wallet, X } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { loadCloudState, loadLocalState, saveCloudState, saveLocalState } from './lib/storage'

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const OUT_TYPES = { fixa:['Fixa','green'], cartao:['Cartão','gold'], divida:['Dívida','red'] }
const IN_TYPES = { salario:['Salário','green'], extra:['Renda extra','blue'], devem:['Me devem','purple'] }
const id = () => crypto.randomUUID()
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
const nextMonth = key => { const [y,m]=key.split('-').map(Number); return monthKey(new Date(y,m,1)) }
const initialState = () => { const key=monthKey(); return { mesesLista:[key], mesAtual:key, dados:{[key]:{saidas:[],entradas:[]}} } }
const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const monthLabel = key => { const [y,m]=key.split('-').map(Number); return `${MONTHS[m-1].slice(0,3)}/${String(y).slice(2)}` }
const longLabel = key => { const [y,m]=key.split('-').map(Number); return `${MONTHS[m-1]} de ${y}` }
const numberValue = value => Number(String(value).replace(',','.'))

export default function App() {
  const [state,setState] = useState(null)
  const [session,setSession] = useState(null)
  const [status,setStatus] = useState('Carregando seu caderno de contas...')
  const [authOpen,setAuthOpen] = useState(false)
  const [confirmDelete,setConfirmDelete] = useState(null)
  const [year,setYear] = useState(null)
  const [income,setIncome] = useState({desc:'',valor:'',tipo:'salario'})
  const [expense,setExpense] = useState({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]})

  useEffect(() => {
    let active=true
    async function start() {
      const current = isSupabaseConfigured ? (await supabase.auth.getSession()).data.session : null
      if (!active) return
      setSession(current)
      const local=loadLocalState()
      let loaded=local
      if (current?.user) {
        try { loaded=await loadCloudState(current.user.id) || local } catch { setStatus('Sem conexão com a nuvem — usando dados deste dispositivo.') }
      }
      setState(loaded || initialState()); setStatus('')
    }
    start()
    const listener=isSupabaseConfigured ? supabase.auth.onAuthStateChange((_event,newSession)=>{ setSession(newSession); if(newSession?.user) loadCloudState(newSession.user.id).then(cloud=>setState(cloud || loadLocalState() || initialState())).catch(()=>{}) }).data.subscription : null
    return()=>{ active=false; listener?.unsubscribe() }
  },[])

  async function persist(next) {
    setState(next); saveLocalState(next); setStatus('Salvando...')
    try { if(session?.user) await saveCloudState(session.user.id,next); setStatus(session?.user?'Salvo na nuvem':'Salvo neste dispositivo') }
    catch { setStatus('Salvo neste dispositivo; a sincronização falhou.') }
  }
  if(!state) return <main className="loading">{status}</main>

  const key=state.mesAtual
  const data=state.dados[key] || {saidas:[],entradas:[]}
  const selectedYear=year ?? Number(key.slice(0,4))
  const years=[...new Set([...state.mesesLista.map(m=>Number(m.slice(0,4))),selectedYear])].sort()
  const months=state.mesesLista.filter(m=>Number(m.slice(0,4))===selectedYear)
  const totalIn=data.entradas.filter(item=>item.recebida!==false).reduce((sum,item)=>sum+item.valor,0)
  const paid=data.saidas.filter(item=>item.paga).reduce((sum,item)=>sum+item.valor,0)
  const totalOut=data.saidas.reduce((sum,item)=>sum+item.valor,0)

  function updateMonth(fn){ const updated=fn(data); persist({...state,dados:{...state.dados,[key]:updated}}) }
  function addIncome(){ const valor=numberValue(income.valor); if(!income.desc.trim()||valor<=0)return; updateMonth(m=>({...m,entradas:[...m.entradas,{id:id(),desc:income.desc.trim(),valor,tipo:income.tipo,recebida:income.tipo!=='devem'}]})); setIncome({desc:'',valor:'',tipo:'salario'}) }
  function addExpense(){ const valor=numberValue(expense.valor); if(!expense.desc.trim()||valor<=0)return; const parcelaTotal=expense.tipo==='fixa'?1:Math.max(1,parseInt(expense.parcelas)||1); updateMonth(m=>({...m,saidas:[...m.saidas,{id:id(),desc:expense.desc.trim(),valor,tipo:expense.tipo,paga:false,parcelaAtual:1,parcelaTotal,detalhes:expense.tipo==='cartao'?expense.detalhes:[]}]})); setExpense({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]}) }
  function advance(){
    const target=nextMonth(key); const existing=state.dados[target]||{saidas:[],entradas:[]}; const chains=new Set(existing.saidas.map(s=>s.origemId||s.id))
    const carried=data.saidas.flatMap(s=>{ const origemId=s.origemId||s.id; if(chains.has(origemId))return[]; if(s.tipo==='fixa')return[{...s,id:id(),origemId,paga:false}]; if(s.parcelaTotal>1&&s.parcelaAtual<s.parcelaTotal)return[{...s,id:id(),origemId,paga:false,parcelaAtual:s.parcelaAtual+1}]; return[] })
    const next={...state,mesAtual:target,mesesLista:[...new Set([...state.mesesLista,target])].sort(),dados:{...state.dados,[target]:{...existing,saidas:[...existing.saidas,...carried]}}}; setYear(Number(target.slice(0,4))); persist(next)
  }
  function deleteMonth(target){ if(state.mesesLista.length===1)return; const list=state.mesesLista.filter(m=>m!==target); const dados={...state.dados}; delete dados[target]; const current=target===key?(list.find(m=>m<target)||list[0]):key; setConfirmDelete(null); setYear(Number(current.slice(0,4))); persist({...state,mesesLista:list,mesAtual:current,dados}) }

  return <main className="page"><div className="shell">
    <header><div className="brand"><Wallet/><div><h1>Caderno de Contas</h1><p>{longLabel(key)}</p></div></div><div className="header-actions"><select value={selectedYear} onChange={e=>{const y=Number(e.target.value);setYear(y);const first=state.mesesLista.find(m=>Number(m.slice(0,4))===y);if(first)persist({...state,mesAtual:first})}}>{years.map(y=><option key={y}>{y}</option>)}</select><button className="auth-button" onClick={()=>session?supabase.auth.signOut():setAuthOpen(true)}>{session?<><LogOut/> Sair</>:<><LogIn/> Entrar</>}</button></div></header>
    {authOpen&&<AuthDialog onClose={()=>setAuthOpen(false)}/>} 
    <nav className="tabs">{months.map(m=><button key={m} className={m===key?'active':''} onClick={()=>persist({...state,mesAtual:m})}>{monthLabel(m)}{state.mesesLista.length>1&&<X onClick={e=>{e.stopPropagation();setConfirmDelete(m)}}/>}</button>)}<button onClick={advance}><Plus/> mês</button></nav>
    {confirmDelete&&<div className="confirm">Excluir <strong>{monthLabel(confirmDelete)}</strong> e todas as contas dele?<button onClick={()=>deleteMonth(confirmDelete)}>Excluir</button><button className="quiet" onClick={()=>setConfirmDelete(null)}>Cancelar</button></div>}
    <section className="book">
      <div className="summary"><Card label="Total que entrou" value={totalIn} tone="green"/><Card label="Valor pago" value={paid} tone="blue"/><Card label="Restante" value={totalIn-paid} tone={totalIn-paid>=0?'neutral':'red'}/><Card label="Total parcial que saiu" value={totalOut} tone="red"/></div>
      <p className="status">{status}{!session&&' • Entre para sincronizar entre dispositivos.'}</p>
      <Section title="Entradas" tone="income" icon={<ArrowUpCircle/>}>{data.entradas.length===0&&<Empty text="Nenhuma entrada neste mês ainda."/>}{data.entradas.map(item=><Row key={item.id} item={item} types={IN_TYPES} onToggle={()=>updateMonth(m=>({...m,entradas:m.entradas.map(i=>i.id===item.id?{...i,recebida:i.recebida===false}:i)}))} onDelete={()=>updateMonth(m=>({...m,entradas:m.entradas.filter(i=>i.id!==item.id)}))}/>)}<EntryForm value={income} setValue={setIncome} onAdd={addIncome}/></Section>
      <hr/>
      <Section title="Saídas" tone="expense" icon={<ArrowDownCircle/>}>{data.saidas.length===0&&<Empty text="Nenhuma saída neste mês ainda."/>}{data.saidas.map(item=><Row key={item.id} item={item} types={OUT_TYPES} expense onToggle={()=>updateMonth(m=>({...m,saidas:m.saidas.map(i=>i.id===item.id?{...i,paga:!i.paga}:i)}))} onDelete={()=>updateMonth(m=>({...m,saidas:m.saidas.filter(i=>i.id!==item.id)}))}/>)}<ExpenseForm value={expense} setValue={setExpense} onAdd={addExpense}/></Section>
    </section>
  </div></main>
}

function AuthDialog({onClose}){ const [email,setEmail]=useState(''); const [message,setMessage]=useState(''); async function send(){if(!email)return;setMessage('Enviando...');const{error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});setMessage(error?error.message:'Confira seu e-mail para entrar.')} return <div className="overlay"><div className="dialog"><button className="close" onClick={onClose}><X/></button><h2>Sincronize seu caderno</h2><p>Receba um link seguro por e-mail. Não é preciso criar senha.</p><input type="email" placeholder="voce@exemplo.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/><button className="primary" onClick={send}>Enviar link de acesso</button><small>{message}</small></div></div> }
function Card({label,value,tone}){return <div className={`card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>}
function Section({title,tone,icon,children}){return <section className={`section ${tone}`}><h2>{icon}{title}</h2><div className="rows">{children}</div></section>}
function Empty({text}){return <p className="empty">{text}</p>}
function Row({item,types,expense,onToggle,onDelete}){const type=types[item.tipo]||['Outro','neutral'];const checked=expense?item.paga:item.recebida!==false;return <div className={`row-wrap ${checked?'paid':''}`}><div className="row"><button className="check" onClick={onToggle} aria-label={checked?'Marcar como pendente':'Marcar como confirmado'}>{checked?'✓':''}</button><span className="description">{item.desc}</span>{item.parcelaTotal>1&&<span className="installment">{item.parcelaAtual}/{item.parcelaTotal}</span>}<span className={`pill ${type[1]}`}>{type[0]}</span><span className="amount-wrap"><strong className={expense?'out':'in'}>{money(item.valor)}</strong>{expense&&checked&&<span className="paid-stamp">PAGO</span>}</span><button className="trash" onClick={onDelete}><Trash2/></button></div>{expense&&item.tipo==='cartao'&&item.detalhes?.length>0&&<div className="details">{item.detalhes.map(detail=><div className="detail" key={detail.id}><span>{detail.desc}</span><strong>{money(detail.valor)}</strong></div>)}</div>}</div>}
function EntryForm({value,setValue,onAdd}){return <div className="form"><input placeholder="Descrição (ex: salário de agosto)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value})}>{Object.entries(IN_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select><button className="add green" onClick={onAdd}><Plus/> adicionar</button></div>}
function ExpenseForm({value,setValue,onAdd}){const [detail,setDetail]=useState({desc:'',valor:''});function addDetail(){const valor=numberValue(detail.valor);if(!detail.desc.trim()||valor<=0)return;setValue({...value,detalhes:[...(value.detalhes||[]),{id:id(),desc:detail.desc.trim(),valor}]});setDetail({desc:'',valor:''})}return <div className="form expense-form"><input placeholder="Descrição (ex: aluguel)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value,detalhes:e.target.value==='cartao'?value.detalhes:[]})}>{Object.entries(OUT_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select>{value.tipo!=='fixa'&&<input className="parcelas" placeholder="Nº parcelas" inputMode="numeric" value={value.parcelas} onChange={e=>setValue({...value,parcelas:e.target.value})}/>}<button className="add red" onClick={onAdd}><Plus/> adicionar</button>{value.tipo==='cartao'&&<div className="detail-editor"><span className="detail-title">Detalhar compras do cartão <small>(opcional)</small></span><div className="detail-fields"><input placeholder="Subdescrição (ex: mercado)" value={detail.desc} onChange={e=>setDetail({...detail,desc:e.target.value})}/><input placeholder="Subvalor" inputMode="decimal" value={detail.valor} onChange={e=>setDetail({...detail,valor:e.target.value})}/><button className="detail-add" onClick={addDetail}><Plus/> incluir</button></div>{value.detalhes?.map(item=><div className="detail-preview" key={item.id}><span>{item.desc}</span><strong>{money(item.valor)}</strong><button onClick={()=>setValue({...value,detalhes:value.detalhes.filter(d=>d.id!==item.id)})}><X/></button></div>)}</div>}</div>}
