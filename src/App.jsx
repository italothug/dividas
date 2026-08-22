import React, { useEffect, useRef, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Download, History, LogIn, LogOut, Pencil, Plus, Trash2, Upload, Wallet, X } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { loadCloudHistory, loadCloudState, loadLocalState, saveCloudState, saveLocalState } from './lib/storage'
import { cardDetailSummary, parseCurrency, validateLedgerState } from './lib/ledger'
import './enhancements.css'

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

export default function App() {
  const [state,setState] = useState(null)
  const [session,setSession] = useState(null)
  const [status,setStatus] = useState('Carregando seu caderno de contas...')
  const [authOpen,setAuthOpen] = useState(false)
  const [confirmDelete,setConfirmDelete] = useState(null)
  const [year,setYear] = useState(null)
  const [income,setIncome] = useState({desc:'',valor:'',tipo:'salario'})
  const [expense,setExpense] = useState({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]})
  const [conflict,setConflict] = useState(null)
  const [history,setHistory] = useState(null)
  const [undo,setUndo] = useState(null)
  const [editing,setEditing] = useState(null)
  const importRef=useRef(null)
  const versionRef=useRef(null)
  const pendingRef=useRef(0)
  const saveQueueRef=useRef(Promise.resolve())

  useEffect(() => {
    let active=true
    async function start() {
      const current = isSupabaseConfigured ? (await supabase.auth.getSession()).data.session : null
      if (!active) return
      setSession(current)
      const local=loadLocalState()
      let loaded=local
      if (current?.user) {
        try { const cloud=await loadCloudState(current.user.id); loaded=cloud?.state || local; versionRef.current=cloud?.version ?? null } catch { setStatus('Sem conexão com a nuvem — usando dados deste dispositivo.') }
      }
      const checked=loaded?validateLedgerState(loaded):{valid:false}
      setState(checked.valid?loaded:initialState()); setStatus(loaded&&!checked.valid?'Os dados inválidos foram isolados para proteger o caderno.':'')
    }
    start()
    const listener=isSupabaseConfigured ? supabase.auth.onAuthStateChange((_event,newSession)=>{ setSession(newSession); if(newSession?.user) loadCloudState(newSession.user.id).then(cloud=>{versionRef.current=cloud?.version??null;setState(cloud?.state || loadLocalState() || initialState())}).catch(()=>{}) }).data.subscription : null
    return()=>{ active=false; listener?.unsubscribe() }
  },[])

  useEffect(() => {
    const userId=session?.user?.id
    if(!isSupabaseConfigured||!userId)return

    const channel=supabase
      .channel(`ledger-state-${userId}`)
      .on('postgres_changes',{
        event:'*',
        schema:'public',
        table:'ledger_states',
        filter:`user_id=eq.${userId}`,
      },payload=>{
        const remoteState=payload.new?.state
        const remoteVersion=payload.new?.version
        if(!remoteState||!validateLedgerState(remoteState).valid||remoteVersion<=Number(versionRef.current||0))return
        if(pendingRef.current>0){setStatus('Outra alteração foi detectada; verificando conflito...');return}
        versionRef.current=remoteVersion
        setState(remoteState)
        saveLocalState(remoteState)
        setStatus('Sincronizado em tempo real')
      })
      .subscribe(subscriptionStatus=>{
        if(subscriptionStatus==='SUBSCRIBED')setStatus('Sincronização em tempo real ativa')
      })

    return()=>{supabase.removeChannel(channel)}
  },[session?.user?.id])

  function persist(next) {
    const checked=validateLedgerState(next)
    if(!checked.valid){setStatus(checked.message);return}
    setState(next); saveLocalState(next)
    if(!session?.user){setStatus('Salvo neste dispositivo');return}
    setStatus('Salvando...'); pendingRef.current+=1
    saveQueueRef.current=saveQueueRef.current.catch(()=>{}).then(async()=>{
      try {
        const saved=await saveCloudState(session.user.id,next,versionRef.current)
        versionRef.current=saved.version
        setStatus('Salvo na nuvem')
      } catch(error) {
        if(error.code==='LEDGER_CONFLICT'||error.code==='23505'){
          const cloud=await loadCloudState(session.user.id)
          if(cloud)setConflict({local:next,remote:cloud.state,remoteVersion:cloud.version})
          setStatus('Conflito detectado — escolha qual versão manter.')
        } else setStatus('Salvo neste dispositivo; a sincronização falhou.')
      } finally { pendingRef.current=Math.max(0,pendingRef.current-1) }
    })
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
  function addIncome(){ const valor=parseCurrency(income.valor); if(!income.desc.trim()||!Number.isFinite(valor)||valor<=0){setStatus('Informe uma descrição e um valor válido.');return} updateMonth(m=>({...m,entradas:[...m.entradas,{id:id(),desc:income.desc.trim(),valor,tipo:income.tipo,recebida:income.tipo!=='devem'}]})); setIncome({desc:'',valor:'',tipo:'salario'}) }
  function addExpense(){ const valor=parseCurrency(expense.valor); if(!expense.desc.trim()||!Number.isFinite(valor)||valor<=0){setStatus('Informe uma descrição e um valor válido.');return} const details=expense.tipo==='cartao'?expense.detalhes:[]; if(cardDetailSummary(valor,details).exceeds){setStatus('Os subvalores não podem ultrapassar o total do cartão.');return} const parcelaTotal=expense.tipo==='fixa'?1:Math.max(1,parseInt(expense.parcelas)||1); updateMonth(m=>({...m,saidas:[...m.saidas,{id:id(),desc:expense.desc.trim(),valor,tipo:expense.tipo,paga:false,parcelaAtual:1,parcelaTotal,detalhes:details}]})); setExpense({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]}) }
  function advance(){
    const target=nextMonth(key); const existing=state.dados[target]||{saidas:[],entradas:[]}; const chains=new Set(existing.saidas.map(s=>s.origemId||s.id))
    const carried=data.saidas.flatMap(s=>{ const origemId=s.origemId||s.id; if(chains.has(origemId))return[]; if(s.tipo==='fixa')return[{...s,id:id(),origemId,paga:false}]; if(s.parcelaTotal>1&&s.parcelaAtual<s.parcelaTotal)return[{...s,id:id(),origemId,paga:false,parcelaAtual:s.parcelaAtual+1}]; return[] })
    const next={...state,mesAtual:target,mesesLista:[...new Set([...state.mesesLista,target])].sort(),dados:{...state.dados,[target]:{...existing,saidas:[...existing.saidas,...carried]}}}; setYear(Number(target.slice(0,4))); persist(next)
  }
  function deleteMonth(target){ if(state.mesesLista.length===1)return; const list=state.mesesLista.filter(m=>m!==target); const dados={...state.dados}; delete dados[target]; const current=target===key?(list.find(m=>m<target)||list[0]):key; setConfirmDelete(null); setYear(Number(current.slice(0,4))); persist({...state,mesesLista:list,mesAtual:current,dados}) }

  function deleteItem(kind,item){const previous=state;const label=item.desc;updateMonth(m=>({...m,[kind]:m[kind].filter(i=>i.id!==item.id)}));setUndo({state:previous,label})}
  function restoreUndo(){if(!undo)return;persist(undo.state);setUndo(null)}
  function saveEdit(item){const collection=editing.kind;updateMonth(m=>({...m,[collection]:m[collection].map(existing=>existing.id===item.id?item:existing)}));setEditing(null)}
  function chooseCloud(){versionRef.current=conflict.remoteVersion;setState(conflict.remote);saveLocalState(conflict.remote);setConflict(null);setStatus('Versão da nuvem recuperada.')}
  function chooseLocal(){const local=conflict.local;versionRef.current=conflict.remoteVersion;setConflict(null);persist(local)}
  function exportLedger(){const blob=new Blob([JSON.stringify({format:'caderno-de-contas',version:1,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`caderno-de-contas-${key}.json`;link.click();URL.revokeObjectURL(url);setStatus('Backup exportado.')}
  async function importLedger(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;try{const parsed=JSON.parse(await file.text());const imported=parsed.state||parsed;const checked=validateLedgerState(imported);if(!checked.valid)throw new Error(checked.message);setUndo({state,label:'caderno anterior'});persist(imported);setYear(Number(imported.mesAtual.slice(0,4)));setStatus('Backup importado com sucesso.')}catch(error){setStatus(error.message||'Não foi possível importar este arquivo.')}}
  async function openHistory(){if(!session?.user){setStatus('Entre na sua conta para consultar o histórico na nuvem.');return}setStatus('Carregando histórico...');try{setHistory(await loadCloudHistory(session.user.id));setStatus('')}catch{setStatus('Não foi possível carregar o histórico.')}}

  return <main className="page"><div className="shell">
    <header><div className="brand"><Wallet/><div><h1>Caderno de Contas</h1><p>{longLabel(key)}</p></div></div><div className="header-actions"><select aria-label="Ano" value={selectedYear} onChange={e=>{const y=Number(e.target.value);setYear(y);const first=state.mesesLista.find(m=>Number(m.slice(0,4))===y);if(first)persist({...state,mesAtual:first})}}>{years.map(y=><option key={y}>{y}</option>)}</select><button className="auth-button" onClick={()=>session?supabase.auth.signOut():setAuthOpen(true)}>{session?<><LogOut/> Sair</>:<><LogIn/> Entrar</>}</button></div></header>
    {authOpen&&<AuthDialog onClose={()=>setAuthOpen(false)}/>} 
    {editing&&<EditDialog edit={editing} onSave={saveEdit} onClose={()=>setEditing(null)}/>}
    {history&&<HistoryDialog items={history} onClose={()=>setHistory(null)} onRestore={item=>{setHistory(null);persist(item.state)}}/>}
    {conflict&&<div className="conflict" role="alert"><strong>Alterações diferentes foram feitas em dois dispositivos.</strong><span>Nenhuma versão foi apagada. Escolha qual deseja manter.</span><button onClick={chooseCloud}>Usar versão da nuvem</button><button onClick={chooseLocal}>Manter minhas alterações</button></div>}
    <nav className="tabs">{months.map(m=><button key={m} className={m===key?'active':''} onClick={()=>persist({...state,mesAtual:m})}>{monthLabel(m)}{state.mesesLista.length>1&&<X onClick={e=>{e.stopPropagation();setConfirmDelete(m)}}/>}</button>)}<button onClick={advance}><Plus/> mês</button></nav>
    {confirmDelete&&<div className="confirm">Excluir <strong>{monthLabel(confirmDelete)}</strong> e todas as contas dele?<button onClick={()=>deleteMonth(confirmDelete)}>Excluir</button><button className="quiet" onClick={()=>setConfirmDelete(null)}>Cancelar</button></div>}
    <section className="book">
      <div className="tools"><button onClick={exportLedger}><Download/> Exportar backup</button><button onClick={()=>importRef.current?.click()}><Upload/> Importar</button><button onClick={openHistory}><History/> Histórico</button><input ref={importRef} type="file" accept="application/json,.json" onChange={importLedger} hidden/></div>
      <div className="summary"><Card label="Total que entrou" value={totalIn} tone="green"/><Card label="Valor pago" value={paid} tone="blue"/><Card label="Restante" value={totalIn-paid} tone={totalIn-paid>=0?'neutral':'red'}/><Card label="Total parcial que saiu" value={totalOut} tone="red"/></div>
      <p className="status">{status}{!session&&' • Entre para sincronizar entre dispositivos.'}</p>
      {undo&&<div className="undo" role="status"><span>“{undo.label}” foi removido.</span><button onClick={restoreUndo}>Desfazer</button><button aria-label="Fechar aviso" onClick={()=>setUndo(null)}><X/></button></div>}
      <Section title="Entradas" tone="income" icon={<ArrowUpCircle/>}>{data.entradas.length===0&&<Empty text="Nenhuma entrada neste mês ainda."/>}{data.entradas.map(item=><Row key={item.id} item={item} types={IN_TYPES} onToggle={()=>updateMonth(m=>({...m,entradas:m.entradas.map(i=>i.id===item.id?{...i,recebida:i.recebida===false}:i)}))} onEdit={()=>setEditing({kind:'entradas',item})} onDelete={()=>deleteItem('entradas',item)}/>)}<EntryForm value={income} setValue={setIncome} onAdd={addIncome}/></Section>
      <hr/>
      <Section title="Saídas" tone="expense" icon={<ArrowDownCircle/>}>{data.saidas.length===0&&<Empty text="Nenhuma saída neste mês ainda."/>}{data.saidas.map(item=><Row key={item.id} item={item} types={OUT_TYPES} expense onToggle={()=>updateMonth(m=>({...m,saidas:m.saidas.map(i=>i.id===item.id?{...i,paga:!i.paga}:i)}))} onEdit={()=>setEditing({kind:'saidas',item})} onDelete={()=>deleteItem('saidas',item)}/>)}<ExpenseForm value={expense} setValue={setExpense} onAdd={addExpense}/></Section>
    </section>
  </div></main>
}

function AuthDialog({onClose}){ const [email,setEmail]=useState(''); const [message,setMessage]=useState(''); async function send(){if(!email)return;setMessage('Enviando...');const{error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});setMessage(error?error.message:'Confira seu e-mail para entrar.')} return <div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="close" aria-label="Fechar" onClick={onClose}><X/></button><h2 id="auth-title">Sincronize seu caderno</h2><p>Receba um link seguro por e-mail. Não é preciso criar senha.</p><label>E-mail<input type="email" placeholder="voce@exemplo.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/></label><button className="primary" onClick={send}>Enviar link de acesso</button><small aria-live="polite">{message}</small></div></div> }
function EditDialog({edit,onSave,onClose}){const expense=edit.kind==='saidas';const [item,setItem]=useState({...edit.item});const [value,setValue]=useState(String(edit.item.valor).replace('.',','));const [detail,setDetail]=useState({desc:'',valor:''});const [error,setError]=useState('');const types=expense?OUT_TYPES:IN_TYPES;function addDetail(){const valor=parseCurrency(detail.valor);if(!detail.desc.trim()||!Number.isFinite(valor)||valor<=0)return;setItem({...item,detalhes:[...(item.detalhes||[]),{id:id(),desc:detail.desc.trim(),valor}]});setDetail({desc:'',valor:''})}function save(){const valor=parseCurrency(value);if(!item.desc.trim()||!Number.isFinite(valor)||valor<=0){setError('Informe uma descrição e um valor válido.');return}const next={...item,desc:item.desc.trim(),valor};if(expense&&next.tipo==='cartao'&&cardDetailSummary(valor,next.detalhes).exceeds){setError('Os subvalores ultrapassam o total do cartão.');return}onSave(next)}return <div className="overlay"><div className="dialog edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title"><button className="close" aria-label="Fechar" onClick={onClose}><X/></button><h2 id="edit-title">Editar lançamento</h2><label>Descrição<input value={item.desc} onChange={e=>setItem({...item,desc:e.target.value})}/></label><label>Valor<input inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)}/></label><label>Categoria<select value={item.tipo} onChange={e=>setItem({...item,tipo:e.target.value,detalhes:e.target.value==='cartao'?item.detalhes:[]})}>{Object.entries(types).map(([key,type])=><option key={key} value={key}>{type[0]}</option>)}</select></label>{expense&&item.tipo!=='fixa'&&<div className="edit-grid"><label>Parcela atual<input type="number" min="1" value={item.parcelaAtual||1} onChange={e=>setItem({...item,parcelaAtual:Math.max(1,Number(e.target.value))})}/></label><label>Total de parcelas<input type="number" min="1" value={item.parcelaTotal||1} onChange={e=>setItem({...item,parcelaTotal:Math.max(1,Number(e.target.value))})}/></label></div>}{expense&&item.tipo==='cartao'&&<div className="edit-details"><strong>Detalhes do cartão</strong>{item.detalhes?.map(entry=><div className="detail-preview" key={entry.id}><span>{entry.desc}</span><strong>{money(entry.valor)}</strong><button aria-label={`Remover ${entry.desc}`} onClick={()=>setItem({...item,detalhes:item.detalhes.filter(d=>d.id!==entry.id)})}><X/></button></div>)}<div className="detail-fields"><input aria-label="Nova subdescrição" placeholder="Subdescrição" value={detail.desc} onChange={e=>setDetail({...detail,desc:e.target.value})}/><input aria-label="Novo subvalor" placeholder="Subvalor" inputMode="decimal" value={detail.valor} onChange={e=>setDetail({...detail,valor:e.target.value})}/><button className="detail-add" onClick={addDetail}><Plus/> incluir</button></div></div>}<small className="form-error">{error}</small><button className="primary" onClick={save}>Salvar alterações</button></div></div>}
function HistoryDialog({items,onClose,onRestore}){return <div className="overlay"><div className="dialog history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title"><button className="close" aria-label="Fechar" onClick={onClose}><X/></button><h2 id="history-title">Histórico na nuvem</h2><p>As versões anteriores são criadas automaticamente antes de cada alteração.</p>{items.length===0?<p>Nenhuma versão anterior disponível.</p>:<div className="history-list">{items.map(item=><div key={item.id}><span>Versão {item.version}<small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></span><button onClick={()=>onRestore(item)}>Restaurar</button></div>)}</div>}</div></div>}
function Card({label,value,tone}){return <div className={`card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>}
function Section({title,tone,icon,children}){return <section className={`section ${tone}`}><h2>{icon}{title}</h2><div className="rows">{children}</div></section>}
function Empty({text}){return <p className="empty">{text}</p>}
function Row({item,types,expense,onToggle,onEdit,onDelete}){const type=types[item.tipo]||['Outro','neutral'];const checked=expense?item.paga:item.recebida!==false;return <div className={`row-wrap ${checked?'paid':''}`}><div className="row"><button className="check" onClick={onToggle} aria-label={checked?'Marcar como pendente':'Marcar como confirmado'}>{checked?'✓':''}</button><span className="description">{item.desc}</span>{item.parcelaTotal>1&&<span className="installment">{item.parcelaAtual}/{item.parcelaTotal}</span>}<span className={`pill ${type[1]}`}>{type[0]}</span><span className="amount-wrap"><strong className={expense?'out':'in'}>{money(item.valor)}</strong>{expense&&checked&&<span className="paid-stamp">PAGO</span>}</span><button className="edit" aria-label={`Editar ${item.desc}`} onClick={onEdit}><Pencil/></button><button className="trash" aria-label={`Excluir ${item.desc}`} onClick={onDelete}><Trash2/></button></div>{expense&&item.tipo==='cartao'&&item.detalhes?.length>0&&<div className="details">{item.detalhes.map(detail=><div className="detail" key={detail.id}><span>{detail.desc}</span><strong>{money(detail.valor)}</strong></div>)}</div>}</div>}
function EntryForm({value,setValue,onAdd}){return <div className="form"><input aria-label="Descrição da entrada" placeholder="Descrição (ex: salário de agosto)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input aria-label="Valor da entrada" placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select aria-label="Tipo da entrada" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value})}>{Object.entries(IN_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select><button className="add green" onClick={onAdd}><Plus/> adicionar</button></div>}
function ExpenseForm({value,setValue,onAdd}){const [detail,setDetail]=useState({desc:'',valor:''});const total=parseCurrency(value.valor);const summary=cardDetailSummary(Number.isFinite(total)?total:0,value.detalhes);function addDetail(){const valor=parseCurrency(detail.valor);if(!detail.desc.trim()||!Number.isFinite(valor)||valor<=0)return;const next=[...(value.detalhes||[]),{id:id(),desc:detail.desc.trim(),valor}];if(Number.isFinite(total)&&cardDetailSummary(total,next).exceeds)return;setValue({...value,detalhes:next});setDetail({desc:'',valor:''})}return <div className="form expense-form"><input aria-label="Descrição da saída" placeholder="Descrição (ex: aluguel)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input aria-label="Valor da saída" placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select aria-label="Tipo da saída" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value,detalhes:e.target.value==='cartao'?value.detalhes:[]})}>{Object.entries(OUT_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select>{value.tipo!=='fixa'&&<input aria-label="Número de parcelas" className="parcelas" placeholder="Nº parcelas" inputMode="numeric" value={value.parcelas} onChange={e=>setValue({...value,parcelas:e.target.value})}/>}<button className="add red" onClick={onAdd}><Plus/> adicionar</button>{value.tipo==='cartao'&&<div className="detail-editor"><span className="detail-title">Detalhar compras do cartão <small>(opcional)</small></span><div className="detail-fields"><input aria-label="Subdescrição" placeholder="Subdescrição (ex: mercado)" value={detail.desc} onChange={e=>setDetail({...detail,desc:e.target.value})}/><input aria-label="Subvalor" placeholder="Subvalor" inputMode="decimal" value={detail.valor} onChange={e=>setDetail({...detail,valor:e.target.value})}/><button className="detail-add" onClick={addDetail}><Plus/> incluir</button></div><small className={summary.exceeds?'detail-warning':''}>Detalhado: {money(summary.detailed)} · Falta: {money(Math.max(0,summary.remaining))}</small>{value.detalhes?.map(item=><div className="detail-preview" key={item.id}><span>{item.desc}</span><strong>{money(item.valor)}</strong><button aria-label={`Remover ${item.desc}`} onClick={()=>setValue({...value,detalhes:value.detalhes.filter(d=>d.id!==item.id)})}><X/></button></div>)}</div>}</div>}
