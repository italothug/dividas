import React, { useEffect, useRef, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Download, History, LogIn, LogOut, Pencil, Plus, RefreshCw, Smartphone, Trash2, Upload, Wallet, WifiOff, X } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { clearPendingSync, loadCloudHistory, loadCloudState, loadLocalState, loadPendingSync, saveCloudState, saveLocalState, savePendingSync } from './lib/storage'
import { cardDetailSummary, financialSummary, parseCurrency, validateLedgerState } from './lib/ledger'
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
  const [online,setOnline] = useState(navigator.onLine)
  const [lastSync,setLastSync] = useState(null)
  const [installPrompt,setInstallPrompt] = useState(null)
  const importRef=useRef(null)
  const versionRef=useRef(null)
  const pendingRef=useRef(0)
  const saveQueueRef=useRef(Promise.resolve())

  useEffect(()=>{
    const wentOnline=()=>setOnline(true)
    const wentOffline=()=>setOnline(false)
    const captureInstall=event=>{event.preventDefault();setInstallPrompt(event)}
    window.addEventListener('online',wentOnline)
    window.addEventListener('offline',wentOffline)
    window.addEventListener('beforeinstallprompt',captureInstall)
    return()=>{window.removeEventListener('online',wentOnline);window.removeEventListener('offline',wentOffline);window.removeEventListener('beforeinstallprompt',captureInstall)}
  },[])

  useEffect(() => {
    let active=true
    async function start() {
      const current = isSupabaseConfigured ? (await supabase.auth.getSession()).data.session : null
      if (!active) return
      setSession(current)
      const local=loadLocalState()
      let loaded=local
      if (current?.user) {
        try { const cloud=await loadCloudState(current.user.id); loaded=cloud?.state || local; versionRef.current=cloud?.version ?? null;setLastSync(cloud?.updatedAt||null) } catch { setStatus('Sem conexão com a nuvem — usando dados deste dispositivo.') }
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

  useEffect(()=>{
    if(!online||!session?.user||!loadPendingSync())return
    const pending=loadPendingSync()
    if(pending?.state){setStatus('Enviando alteração pendente...');persist(pending.state)}
  // persist deliberately uses the latest session and version when connectivity returns.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[online,session?.user?.id])

  function persist(next) {
    const checked=validateLedgerState(next)
    if(!checked.valid){setStatus(checked.message);return}
    setState(next); saveLocalState(next)
    if(!session?.user){setStatus('Salvo neste dispositivo');return}
    savePendingSync(next)
    if(!navigator.onLine){setStatus('Sem internet — alteração aguardando sincronização.');return}
    setStatus('Salvando...'); pendingRef.current+=1
    saveQueueRef.current=saveQueueRef.current.catch(()=>{}).then(async()=>{
      try {
        const saved=await saveCloudState(session.user.id,next,versionRef.current)
        versionRef.current=saved.version
        clearPendingSync()
        setLastSync(saved.updatedAt)
        setStatus('Salvo na nuvem')
      } catch(error) {
        if(error.code==='LEDGER_CONFLICT'||error.code==='23505'){
          const cloud=await loadCloudState(session.user.id)
          if(cloud)setConflict({local:next,remote:cloud.state,remoteVersion:cloud.version})
          setStatus('Conflito detectado — escolha qual versão manter.')
        } else setStatus('Salvo neste dispositivo; aguardando sincronização.')
      } finally { pendingRef.current=Math.max(0,pendingRef.current-1) }
    })
  }
  if(!state) return <main className="loading">{status}</main>

  const key=state.mesAtual
  const data=state.dados[key] || {saidas:[],entradas:[]}
  const selectedYear=year ?? Number(key.slice(0,4))
  const years=[...new Set([...state.mesesLista.map(m=>Number(m.slice(0,4))),selectedYear])].sort()
  const months=state.mesesLista.filter(m=>Number(m.slice(0,4))===selectedYear)
  const {receivedIncome:totalIn,pendingIncome:pendingIn,paidExpenses:paid,pendingExpenses:pendingOut,currentBalance,projectedBalance}=financialSummary(data)

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
  async function installApp(){if(!installPrompt)return;await installPrompt.prompt();setInstallPrompt(null)}

  return <main className="page"><div className="shell">
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <header><div className="brand"><Wallet aria-hidden="true"/><div><h1>Caderno de Contas</h1><p>{longLabel(key)}</p></div></div><div className="header-actions"><label className="sr-only" htmlFor="year-select">Ano</label><select id="year-select" value={selectedYear} onChange={e=>{const y=Number(e.target.value);setYear(y);const first=state.mesesLista.find(m=>Number(m.slice(0,4))===y);if(first)persist({...state,mesAtual:first})}}>{years.map(y=><option key={y}>{y}</option>)}</select><button type="button" className="auth-button" onClick={()=>session?supabase.auth.signOut():setAuthOpen(true)}>{session?<><LogOut aria-hidden="true"/> Sair</>:<><LogIn aria-hidden="true"/> Entrar</>}</button></div></header>
    {authOpen&&<AuthDialog onClose={()=>setAuthOpen(false)}/>} 
    {editing&&<EditDialog edit={editing} onSave={saveEdit} onClose={()=>setEditing(null)}/>}
    {history&&<HistoryDialog items={history} onClose={()=>setHistory(null)} onRestore={item=>{setHistory(null);persist(item.state)}}/>}
    {conflict&&<div className="conflict" role="alert"><strong>Alterações diferentes foram feitas em dois dispositivos.</strong><span>Nenhuma versão foi apagada. Escolha qual deseja manter.</span><button onClick={chooseCloud}>Usar versão da nuvem</button><button onClick={chooseLocal}>Manter minhas alterações</button></div>}
    <nav className="tabs" aria-label="Meses do caderno">{months.map(m=><span className={`month-tab ${m===key?'active':''}`} key={m}><button type="button" aria-current={m===key?'page':undefined} onClick={()=>persist({...state,mesAtual:m})}>{monthLabel(m)}</button>{state.mesesLista.length>1&&<button type="button" className="delete-month" aria-label={`Excluir ${longLabel(m)}`} onClick={()=>setConfirmDelete(m)}><X aria-hidden="true"/></button>}</span>)}<button type="button" onClick={advance}><Plus aria-hidden="true"/> mês</button></nav>
    {confirmDelete&&<div className="confirm">Excluir <strong>{monthLabel(confirmDelete)}</strong> e todas as contas dele?<button onClick={()=>deleteMonth(confirmDelete)}>Excluir</button><button className="quiet" onClick={()=>setConfirmDelete(null)}>Cancelar</button></div>}
    <section className="book" id="conteudo">
      <div className="tools"><button type="button" onClick={exportLedger}><Download aria-hidden="true"/> Exportar backup</button><button type="button" onClick={()=>importRef.current?.click()}><Upload aria-hidden="true"/> Importar</button><button type="button" onClick={openHistory}><History aria-hidden="true"/> Histórico</button>{installPrompt&&<button type="button" onClick={installApp}><Smartphone aria-hidden="true"/> Instalar aplicativo</button>}<input ref={importRef} type="file" aria-label="Selecionar backup JSON" accept="application/json,.json" onChange={importLedger} hidden/></div>
      <div className="summary" aria-label="Resumo financeiro"><Card label="Entradas recebidas" value={totalIn} tone="green"/><Card label="Entradas pendentes" value={pendingIn} tone="purple"/><Card label="Despesas pagas" value={paid} tone="blue"/><Card label="Despesas pendentes" value={pendingOut} tone="red"/><Card label="Saldo atual" value={currentBalance} tone={currentBalance>=0?'neutral':'red'}/><Card label="Saldo previsto" value={projectedBalance} tone={projectedBalance>=0?'green':'red'}/></div>
      <div className={`sync-status ${online?'online':'offline'}`} role="status" aria-live="polite">{online?<RefreshCw aria-hidden="true"/>:<WifiOff aria-hidden="true"/>}<span>{status||(!session?'Dados salvos neste dispositivo. Entre para sincronizar.':'Conectado à nuvem')}{session&&lastSync&&<small>Última sincronização: {new Date(lastSync).toLocaleString('pt-BR')}</small>}</span></div>
      {undo&&<div className="undo" role="status"><span>“{undo.label}” foi removido.</span><button onClick={restoreUndo}>Desfazer</button><button aria-label="Fechar aviso" onClick={()=>setUndo(null)}><X/></button></div>}
      <Section title="Entradas" tone="income" icon={<ArrowUpCircle/>}>{data.entradas.length===0&&<Empty text="Nenhuma entrada neste mês ainda."/>}{data.entradas.map(item=><Row key={item.id} item={item} types={IN_TYPES} onToggle={()=>updateMonth(m=>({...m,entradas:m.entradas.map(i=>i.id===item.id?{...i,recebida:i.recebida===false}:i)}))} onEdit={()=>setEditing({kind:'entradas',item})} onDelete={()=>deleteItem('entradas',item)}/>)}<EntryForm value={income} setValue={setIncome} onAdd={addIncome}/></Section>
      <hr/>
      <Section title="Saídas" tone="expense" icon={<ArrowDownCircle/>}>{data.saidas.length===0&&<Empty text="Nenhuma saída neste mês ainda."/>}{data.saidas.map(item=><Row key={item.id} item={item} types={OUT_TYPES} expense onToggle={()=>updateMonth(m=>({...m,saidas:m.saidas.map(i=>i.id===item.id?{...i,paga:!i.paga}:i)}))} onEdit={()=>setEditing({kind:'saidas',item})} onDelete={()=>deleteItem('saidas',item)}/>)}<ExpenseForm value={expense} setValue={setExpense} onAdd={addExpense}/></Section>
    </section>
  </div></main>
}

function DialogShell({titleId,onClose,className='',children}){const ref=useRef(null);useEffect(()=>{const previous=document.activeElement;const dialog=ref.current;const focusable=dialog?.querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])');focusable?.[0]?.focus();function keys(event){if(event.key==='Escape')onClose();if(event.key==='Tab'&&focusable?.length){const first=focusable[0];const last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}dialog?.addEventListener('keydown',keys);return()=>{dialog?.removeEventListener('keydown',keys);previous?.focus?.()}},[onClose]);return <div className="overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</div></div>}
function AuthDialog({onClose}){ const [email,setEmail]=useState(''); const [message,setMessage]=useState(''); async function send(){if(!email)return;setMessage('Enviando...');const{error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});setMessage(error?error.message:'Confira seu e-mail para entrar.')} return <DialogShell titleId="auth-title" onClose={onClose}><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="auth-title">Sincronize seu caderno</h2><p>Receba um link seguro por e-mail. Não é preciso criar senha.</p><label>E-mail<input type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/></label><button type="button" className="primary" onClick={send}>Enviar link de acesso</button><small aria-live="polite">{message}</small></DialogShell> }
function EditDialog({edit,onSave,onClose}){const expense=edit.kind==='saidas';const [item,setItem]=useState({...edit.item});const [value,setValue]=useState(String(edit.item.valor).replace('.',','));const [detail,setDetail]=useState({desc:'',valor:''});const [error,setError]=useState('');const types=expense?OUT_TYPES:IN_TYPES;function addDetail(){const valor=parseCurrency(detail.valor);if(!detail.desc.trim()||!Number.isFinite(valor)||valor<=0)return;setItem({...item,detalhes:[...(item.detalhes||[]),{id:id(),desc:detail.desc.trim(),valor}]});setDetail({desc:'',valor:''})}function save(){const valor=parseCurrency(value);if(!item.desc.trim()||!Number.isFinite(valor)||valor<=0){setError('Informe uma descrição e um valor válido.');return}const next={...item,desc:item.desc.trim(),valor};if(expense&&next.tipo==='cartao'&&cardDetailSummary(valor,next.detalhes).exceeds){setError('Os subvalores ultrapassam o total do cartão.');return}onSave(next)}return <DialogShell titleId="edit-title" onClose={onClose} className="edit-dialog"><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="edit-title">Editar lançamento</h2><label>Descrição<input value={item.desc} onChange={e=>setItem({...item,desc:e.target.value})}/></label><label>Valor<input inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)}/></label><label>Categoria<select value={item.tipo} onChange={e=>setItem({...item,tipo:e.target.value,detalhes:e.target.value==='cartao'?item.detalhes:[]})}>{Object.entries(types).map(([key,type])=><option key={key} value={key}>{type[0]}</option>)}</select></label>{expense&&item.tipo!=='fixa'&&<div className="edit-grid"><label>Parcela atual<input type="number" min="1" value={item.parcelaAtual||1} onChange={e=>setItem({...item,parcelaAtual:Math.max(1,Number(e.target.value))})}/></label><label>Total de parcelas<input type="number" min="1" value={item.parcelaTotal||1} onChange={e=>setItem({...item,parcelaTotal:Math.max(1,Number(e.target.value))})}/></label></div>}{expense&&item.tipo==='cartao'&&<div className="edit-details"><strong>Detalhes do cartão</strong>{item.detalhes?.map(entry=><div className="detail-preview" key={entry.id}><span>{entry.desc}</span><strong>{money(entry.valor)}</strong><button type="button" aria-label={`Remover ${entry.desc}`} onClick={()=>setItem({...item,detalhes:item.detalhes.filter(d=>d.id!==entry.id)})}><X aria-hidden="true"/></button></div>)}<div className="detail-fields"><input aria-label="Nova subdescrição" placeholder="Subdescrição" value={detail.desc} onChange={e=>setDetail({...detail,desc:e.target.value})}/><input aria-label="Novo subvalor" placeholder="Subvalor" inputMode="decimal" value={detail.valor} onChange={e=>setDetail({...detail,valor:e.target.value})}/><button type="button" className="detail-add" onClick={addDetail}><Plus aria-hidden="true"/> incluir</button></div></div>}<small className="form-error" aria-live="polite">{error}</small><button type="button" className="primary" onClick={save}>Salvar alterações</button></DialogShell>}
function HistoryDialog({items,onClose,onRestore}){return <DialogShell titleId="history-title" onClose={onClose} className="history-dialog"><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="history-title">Histórico na nuvem</h2><p>As versões anteriores são criadas automaticamente antes de cada alteração.</p>{items.length===0?<p>Nenhuma versão anterior disponível.</p>:<div className="history-list">{items.map(item=><div key={item.id}><span>Versão {item.version}<small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></span><button type="button" onClick={()=>onRestore(item)}>Restaurar</button></div>)}</div>}</DialogShell>}
function Card({label,value,tone}){return <div className={`card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>}
function Section({title,tone,icon,children}){return <section className={`section ${tone}`}><h2>{icon}{title}</h2><div className="rows">{children}</div></section>}
function Empty({text}){return <p className="empty">{text}</p>}
function Row({item,types,expense,onToggle,onEdit,onDelete}){const type=types[item.tipo]||['Outro','neutral'];const checked=expense?item.paga:item.recebida!==false;const action=expense?(checked?'Marcar despesa como pendente':'Marcar despesa como paga'):(checked?'Marcar entrada como pendente':'Marcar entrada como recebida');return <div className={`row-wrap ${checked?'paid':''}`}><div className="row"><button type="button" className="check" onClick={onToggle} aria-label={`${action}: ${item.desc}`} aria-pressed={checked}>{checked?'✓':''}</button><span className="description">{item.desc}</span>{item.parcelaTotal>1&&<span className="installment" aria-label={`Parcela ${item.parcelaAtual} de ${item.parcelaTotal}`}>{item.parcelaAtual}/{item.parcelaTotal}</span>}<span className={`pill ${type[1]}`}>{type[0]}</span><span className="amount-wrap"><strong className={expense?'out':'in'}>{money(item.valor)}</strong>{expense&&checked&&<span className="paid-stamp">PAGO</span>}</span><button type="button" className="edit" aria-label={`Editar ${item.desc}`} onClick={onEdit}><Pencil aria-hidden="true"/></button><button type="button" className="trash" aria-label={`Excluir ${item.desc}`} onClick={onDelete}><Trash2 aria-hidden="true"/></button></div>{expense&&item.tipo==='cartao'&&item.detalhes?.length>0&&<div className="details" aria-label={`Detalhes de ${item.desc}`}>{item.detalhes.map(detail=><div className="detail" key={detail.id}><span>{detail.desc}</span><strong>{money(detail.valor)}</strong></div>)}</div>}</div>}
function EntryForm({value,setValue,onAdd}){return <div className="form"><input aria-label="Descrição da entrada" placeholder="Descrição (ex: salário de agosto)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input aria-label="Valor da entrada" placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select aria-label="Tipo da entrada" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value})}>{Object.entries(IN_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select><button className="add green" onClick={onAdd}><Plus/> adicionar</button></div>}
function ExpenseForm({value,setValue,onAdd}){const [detail,setDetail]=useState({desc:'',valor:''});const total=parseCurrency(value.valor);const summary=cardDetailSummary(Number.isFinite(total)?total:0,value.detalhes);function addDetail(){const valor=parseCurrency(detail.valor);if(!detail.desc.trim()||!Number.isFinite(valor)||valor<=0)return;const next=[...(value.detalhes||[]),{id:id(),desc:detail.desc.trim(),valor}];if(Number.isFinite(total)&&cardDetailSummary(total,next).exceeds)return;setValue({...value,detalhes:next});setDetail({desc:'',valor:''})}return <div className="form expense-form"><input aria-label="Descrição da saída" placeholder="Descrição (ex: aluguel)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><input aria-label="Valor da saída" placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select aria-label="Tipo da saída" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value,detalhes:e.target.value==='cartao'?value.detalhes:[]})}>{Object.entries(OUT_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select>{value.tipo!=='fixa'&&<input aria-label="Número de parcelas" className="parcelas" placeholder="Nº parcelas" inputMode="numeric" value={value.parcelas} onChange={e=>setValue({...value,parcelas:e.target.value})}/>}<button className="add red" onClick={onAdd}><Plus/> adicionar</button>{value.tipo==='cartao'&&<div className="detail-editor"><span className="detail-title">Detalhar compras do cartão <small>(opcional)</small></span><div className="detail-fields"><input aria-label="Subdescrição" placeholder="Subdescrição (ex: mercado)" value={detail.desc} onChange={e=>setDetail({...detail,desc:e.target.value})}/><input aria-label="Subvalor" placeholder="Subvalor" inputMode="decimal" value={detail.valor} onChange={e=>setDetail({...detail,valor:e.target.value})}/><button className="detail-add" onClick={addDetail}><Plus/> incluir</button></div><small className={summary.exceeds?'detail-warning':''}>Detalhado: {money(summary.detailed)} · Falta: {money(Math.max(0,summary.remaining))}</small>{value.detalhes?.map(item=><div className="detail-preview" key={item.id}><span>{item.desc}</span><strong>{money(item.valor)}</strong><button aria-label={`Remover ${item.desc}`} onClick={()=>setValue({...value,detalhes:value.detalhes.filter(d=>d.id!==item.id)})}><X/></button></div>)}</div>}</div>}
