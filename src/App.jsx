import MoneyInput from './MoneyInput'
import React, { useEffect, useRef, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Download, History, LogIn, LogOut, Pencil, Plus, RefreshCw, ShieldCheck, Smartphone, Trash2, Upload, Wallet, WifiOff, X } from 'lucide-react'
import { supabase } from './lib/supabase'
import { approveAccount, loadCloudHistory, loadPendingAccounts } from './lib/storage'
import useLedger from './useLedger'
import LegacyNotice from './LegacyNotice'
import { deleteEntries, undoDeletion, editEntries, backupSummary } from './lib/operations'
import { cardDetailSummary, financialSummary, parseCurrency, validateLedgerState } from './lib/ledger'

import Debtors from './Debtors'
import CardDetails from './CardDetails'
import { scheduleCard, scheduleIncome, ensureMonths, validInstallments } from './lib/planning'

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const OUT_TYPES = { fixa:['Fixa','green'], investimento:['Investimento','blue'], cartao:['Cartão','gold'], divida:['Dívida','red'] }
const IN_TYPES = { salario:['Salário','green'], extra:['Renda extra','blue'], devem:['Devedor','purple'] }
const IN_ORDER = { salario:0, extra:1, devem:2 }
const OUT_ORDER = { fixa:0, investimento:1, cartao:2, divida:3 }
const sortEntries = items => [...items].sort((a,b)=>(IN_ORDER[a.tipo]??99)-(IN_ORDER[b.tipo]??99)||b.valor-a.valor)
const sortExpenses = items => [...items].sort((a,b)=>(OUT_ORDER[a.tipo]??99)-(OUT_ORDER[b.tipo]??99)||b.valor-a.valor)
const id = () => crypto.randomUUID()
function downloadJson(content,name){const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
const nextMonth = key => { const [y,m]=key.split('-').map(Number); return monthKey(new Date(y,m,1)) }
const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const monthLabel = key => { const [y,m]=key.split('-').map(Number); return `${MONTHS[m-1].slice(0,3)}/${String(y).slice(2)}` }
const longLabel = key => { const [y,m]=key.split('-').map(Number); return `${MONTHS[m-1]} de ${y}` }

export default function App() {
  const controller=useLedger()
  return <LedgerWorkspace key={controller.identityKey} controller={controller}/>
}

function LedgerWorkspace({controller}) {
  const {state,session,accountAccess,status,setStatus,persist,logout,online,conflict,lastSync}=controller
  const [view,setView] = useState('ledger')
  const [authOpen,setAuthOpen] = useState(false)
  const [recoveryOpen,setRecoveryOpen] = useState(false)
  const [confirmDelete,setConfirmDelete] = useState(null)
  const [year,setYear] = useState(null)
  const [income,setIncome] = useState({desc:'',valor:'',tipo:'salario'})
  const [expense,setExpense] = useState({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]})
  const [history,setHistory] = useState(null)
  const [restore,setRestore]=useState(null)
  const [removing,setRemoving]=useState(null)
  const [undo,setUndo] = useState(null)
  const [editing,setEditing] = useState(null)
  const [installPrompt,setInstallPrompt] = useState(null)
  const [adminOpen,setAdminOpen] = useState(false)
  const [pendingAccounts,setPendingAccounts] = useState([])
  const importRef=useRef(null)

  useEffect(()=>{
    const captureInstall=event=>{event.preventDefault();setInstallPrompt(event)}
    window.addEventListener('beforeinstallprompt',captureInstall)
    return()=>window.removeEventListener('beforeinstallprompt',captureInstall)
  },[])
  useEffect(()=>{if(controller.recovery)setRecoveryOpen(true)},[controller.recovery])
  if(!state) return <main className="loading">{status}<p><button onClick={()=>window.location.reload()}>Tentar novamente</button></p></main>
  async function openAdmin(){setStatus('Carregando solicitações...');try{setPendingAccounts(await loadPendingAccounts());setAdminOpen(true);setStatus('')}catch{setStatus('Não foi possível carregar as solicitações.')}}
  async function approve(userId,app){await approveAccount(userId,app);setPendingAccounts(items=>items.filter(item=>item.user_id!==userId||item.app!==app));setStatus(`Acesso ao ${app==='comanda'?'Comanda':'Dividas'} aprovado.`)}
  if(session&&!accountAccess)return <main className="loading">Verificando autorização da conta...</main>
  if(session&&!accountAccess?.approved)return <PendingApproval email={session.user.email} requested={accountAccess.requested} onLogout={logout}/>

  const key=state.mesAtual
  const data=state.dados[key] || {saidas:[],entradas:[]}
  const selectedYear=year ?? Number(key.slice(0,4))
  const years=[...new Set([...state.mesesLista.map(m=>Number(m.slice(0,4))),selectedYear])].sort()
  const months=state.mesesLista.filter(m=>Number(m.slice(0,4))===selectedYear)
  const {receivedIncome:totalIn,pendingIncome:pendingIn,paidExpenses:paid,pendingExpenses:pendingOut,currentBalance,projectedBalance}=financialSummary(data)

  function updateMonth(fn){ const updated=fn(data); return persist({...state,dados:{...state.dados,[key]:updated}}) }
  function addIncome(){
    const valor=parseCurrency(income.valor)
    if(!income.desc.trim()||!Number.isFinite(valor)||valor<=0){setStatus('Informe uma descrição e um valor válido.');return}
    const item={id:id(),desc:income.desc.trim(),valor,tipo:income.tipo,recebida:income.tipo!=='devem',parcelaAtual:income.tipo==='devem'?Number(income.parcelaAtual||1):1,parcelaTotal:income.tipo==='devem'?Number(income.parcelaTotal||1):1}
    try{if(!persist(scheduleIncome(state,key,item)))return}catch(error){setStatus(error.message);return}
    setIncome({desc:'',valor:'',tipo:'salario'})
  }
  function addExpense(){
    const valor=parseCurrency(expense.valor)
    if(!expense.desc.trim()||!Number.isFinite(valor)||valor<=0){setStatus('Informe uma descrição e um valor válido.');return}
    const details=expense.tipo==='cartao'?expense.detalhes:[]
    if(cardDetailSummary(valor,details).exceeds){setStatus('Os subvalores não podem ultrapassar o total do cartão.');return}
    const parcelaTotal=expense.tipo==='divida'?Number(expense.parcelas):1
    if(!validInstallments({parcelaAtual:1,parcelaTotal})){setStatus('Informe de 1 a 120 parcelas.');return}
    const item={id:id(),desc:expense.desc.trim(),valor,tipo:expense.tipo,paga:false,parcelaAtual:1,parcelaTotal,detalhes:details}
    if(expense.tipo==='cartao'){
      try{if(!persist(scheduleCard(state,key,item)))return}catch(error){setStatus(error.message);return}
    }else if(!updateMonth(m=>({...m,saidas:[...m.saidas,item]})))return
    setExpense({desc:'',valor:'',tipo:'fixa',parcelas:1,detalhes:[]})
  }
  function advance(){
    const target=nextMonth(key)
    const next=ensureMonths(state,key,target)
    setYear(Number(target.slice(0,4)));persist({...next,mesAtual:target})
  }
  function deleteMonth(target){ if(state.mesesLista.length===1)return; const list=state.mesesLista.filter(m=>m!==target); const dados={...state.dados}; delete dados[target]; const current=target===key?(list.find(m=>m<target)||list[0]):key; setConfirmDelete(null); setYear(Number(current.slice(0,4))); persist({...state,mesesLista:list,mesAtual:current,dados}) }

  function deleteItem(kind,item){setRemoving({kind,item})}
  function confirmRemoval(scope){const result=deleteEntries(state,key,removing.kind,removing.item,scope);if(persist(result.state)){setUndo(result.undo);setRemoving(null)}}
  function restoreUndo(){if(undo&&persist(undoDeletion(state,undo)))setUndo(null)}
  function saveEdit(item,scope){
    try{
      const next=editing.kind==='saidas'&&item.tipo==='cartao'&&scope==='future'
        ?scheduleCard(state,key,item,editing.item)
        :editEntries(state,key,editing.kind,editing.item,item,scope)
      if(persist(next))setEditing(null)
    }catch(error){setStatus(error.message)}
  }
  function previewRestore(imported){const checked=validateLedgerState(imported);if(!checked.valid){setStatus(checked.message);return}setRestore(imported)}
  function confirmRestore(){exportLedger();if(persist(restore)){setYear(Number(restore.mesAtual.slice(0,4)));setUndo(null);setRestore(null);setStatus('Backup restaurado. A versão anterior foi exportada.')}}
  function chooseCloud(){exportLedger();controller.resolve(false)}
  function chooseLocal(){controller.resolve(true)}
  function exportLedger(){downloadJson(JSON.stringify({format:'caderno-de-contas',version:1,exportedAt:new Date().toISOString(),state},null,2),`caderno-de-contas-${key}.json`);setStatus('Backup exportado.')}
  async function importLedger(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;try{if(file.size>10*1024*1024)throw new Error('O backup excede 10 MB.');const parsed=JSON.parse(await file.text());if(parsed.state&&(parsed.format!=='caderno-de-contas'||parsed.version!==1))throw new Error('Formato ou versão de backup não suportado.');previewRestore(parsed.state||parsed)}catch(error){setStatus(error.message||'Não foi possível importar este arquivo.')}}
  async function openHistory(){if(!session?.user){setStatus('Entre na sua conta para consultar o histórico na nuvem.');return}setStatus('Carregando histórico...');try{setHistory(await loadCloudHistory(session.user.id));setStatus('')}catch{setStatus('Não foi possível carregar o histórico.')}}
  async function installApp(){if(!installPrompt)return;await installPrompt.prompt();setInstallPrompt(null)}

  return <main className="page"><div className="shell app-shell">
    <a className="skip-link" href={view==='ledger'?'#conteudo':'#devedores'}>Pular para o conteúdo</a>
    <header><div className="brand"><Wallet aria-hidden="true"/><div><h1>Caderno de Contas</h1><p>{longLabel(key)}</p></div></div><div className="header-actions"><label className="sr-only" htmlFor="year-select">Ano</label><select id="year-select" value={selectedYear} onChange={e=>{const y=Number(e.target.value);setYear(y);const first=state.mesesLista.find(m=>Number(m.slice(0,4))===y);if(first)persist({...state,mesAtual:first})}}>{years.map(y=><option key={y}>{y}</option>)}</select>{accountAccess?.is_admin&&<button type="button" className="auth-button" onClick={openAdmin}><ShieldCheck aria-hidden="true"/> Aprovações</button>}<button type="button" className="auth-button" onClick={()=>session?logout():setAuthOpen(true)}>{session?<><LogOut aria-hidden="true"/> Sair</>:<><LogIn aria-hidden="true"/> Entrar</>}</button></div></header>
    {authOpen&&<AuthDialog onClose={()=>setAuthOpen(false)}/>} 
    {recoveryOpen&&<PasswordDialog onClose={()=>setRecoveryOpen(false)}/>} 
    {editing&&<EditDialog edit={editing} onSave={saveEdit} onClose={()=>setEditing(null)}/>}
    {history&&<HistoryDialog items={history} onClose={()=>setHistory(null)} onRestore={item=>{setHistory(null);previewRestore(item.state)}}/>}
    {restore&&<DialogShell titleId="restore-title" onClose={()=>setRestore(null)}><h2 id="restore-title">Confirmar restauração</h2><p>Este backup contém {backupSummary(restore).months} meses, {backupSummary(restore).entries} lançamentos e {backupSummary(restore).debtors} devedores.</p><p>O caderno atual será substituído. Antes, uma cópia dele será baixada. Guarde esse arquivo.</p><button onClick={confirmRestore}>Exportar atual e restaurar</button><button onClick={()=>setRestore(null)}>Cancelar</button></DialogShell>}
    {removing&&<DialogShell titleId="remove-title" onClose={()=>setRemoving(null)}><h2 id="remove-title">Excluir {removing.item.desc}?</h2><button onClick={()=>confirmRemoval('one')}>Somente este lançamento</button>{['fixa','divida','devem','cartao'].includes(removing.item.tipo)&&<button onClick={()=>confirmRemoval('future')}>Este e os próximos pendentes</button>}<p>Os próximos já pagos ou recebidos serão preservados.</p><button onClick={()=>setRemoving(null)}>Cancelar</button></DialogShell>}
    {adminOpen&&<AdminDialog items={pendingAccounts} onApprove={approve} onClose={()=>setAdminOpen(false)}/>}
    {conflict&&<div className="conflict" role="alert"><strong>Alterações diferentes foram feitas em dois dispositivos.</strong><span>Nenhuma versão foi apagada. Escolha qual deseja manter.</span><button onClick={chooseCloud}>Usar versão da nuvem</button><button onClick={chooseLocal}>Manter minhas alterações</button></div>}
      <div className={`sync-status ${online?'online':'offline'}`} role="status" aria-live="polite">{online?<RefreshCw aria-hidden="true"/>:<WifiOff aria-hidden="true"/>}<span>{status||(!session?'Dados salvos neste dispositivo. Entre para sincronizar.':'Conectado à nuvem')}{session&&lastSync&&<small>Última sincronização: {new Date(lastSync).toLocaleString('pt-BR')}</small>}</span></div>
    <LegacyNotice backup={controller.legacy} onDownload={()=>downloadJson(controller.legacy,'backup-local-anterior.json')}/>
    <div className="workspace-layout"><aside className="sidebar"><nav aria-label="Páginas"><button aria-current={view==='ledger'?'page':undefined} onClick={()=>setView('ledger')}>Caderno de contas</button><button aria-current={view==='debtors'?'page':undefined} onClick={()=>setView('debtors')}>Devedores</button></nav><p>Seu dinheiro, organizado.</p></aside><div className="workspace-content">
    {view==='debtors'&&<Debtors key={session?.user?.id||'local'} debts={state.devedores||[]} onChange={devedores=>persist({...state,devedores})} notify={setStatus}/>}
    <div hidden={view!=='ledger'}>
    <nav className="tabs" aria-label="Meses do caderno">{months.map(m=><span className={`month-tab ${m===key?'active':''}`} key={m}><button type="button" aria-current={m===key?'page':undefined} onClick={()=>persist({...state,mesAtual:m})}>{monthLabel(m)}</button>{state.mesesLista.length>1&&<button type="button" className="delete-month" aria-label={`Excluir ${longLabel(m)}`} onClick={()=>setConfirmDelete(m)}><X aria-hidden="true"/></button>}</span>)}<button type="button" onClick={advance}><Plus aria-hidden="true"/> mês</button></nav>
    {confirmDelete&&<div className="confirm">Excluir <strong>{monthLabel(confirmDelete)}</strong> e todas as contas dele?<button onClick={()=>deleteMonth(confirmDelete)}>Excluir</button><button className="quiet" onClick={()=>setConfirmDelete(null)}>Cancelar</button></div>}
    <section className="book" id="conteudo">
      <div className="tools"><button type="button" onClick={exportLedger}><Download aria-hidden="true"/> Exportar backup</button><button type="button" onClick={()=>importRef.current?.click()}><Upload aria-hidden="true"/> Importar</button><button type="button" onClick={openHistory}><History aria-hidden="true"/> Histórico</button>{installPrompt&&<button type="button" onClick={installApp}><Smartphone aria-hidden="true"/> Instalar aplicativo</button>}<input ref={importRef} type="file" aria-label="Selecionar backup JSON" accept="application/json,.json" onChange={importLedger} hidden/></div>
      <div className="summary" aria-label="Resumo financeiro"><Card label="Entradas recebidas" value={totalIn} tone="green"/><Card label="Entradas pendentes" value={pendingIn} tone="purple"/><Card label="Despesas pagas" value={paid} tone="blue"/><Card label="Despesas pendentes" value={pendingOut} tone="red"/><Card label="Saldo atual" value={currentBalance} tone={currentBalance>=0?'neutral':'red'}/><Card label="Saldo previsto" value={projectedBalance} tone={projectedBalance>=0?'green':'red'}/></div>
      {undo&&<div className="undo" role="status"><span>“{undo.label}” foi removido.</span><button onClick={restoreUndo}>Desfazer</button><button aria-label="Fechar aviso" onClick={()=>setUndo(null)}><X/></button></div>}
      <Section title="Entradas" tone="income" icon={<ArrowUpCircle/>}>{data.entradas.length===0&&<Empty text="Nenhuma entrada neste mês ainda."/>}{sortEntries(data.entradas).map(item=><Row key={item.id} item={item} types={IN_TYPES} onToggle={()=>updateMonth(m=>({...m,entradas:m.entradas.map(i=>i.id===item.id?{...i,recebida:i.recebida===false}:i)}))} onEdit={()=>setEditing({kind:'entradas',item})} onDelete={()=>deleteItem('entradas',item)}/>)}<EntryForm value={income} setValue={setIncome} onAdd={addIncome}/></Section>
      <hr/>
      <Section title="Saídas" tone="expense" icon={<ArrowDownCircle/>}>{data.saidas.length===0&&<Empty text="Nenhuma saída neste mês ainda."/>}{sortExpenses(data.saidas).map(item=><Row key={item.id} item={item} types={OUT_TYPES} expense onToggle={()=>updateMonth(m=>({...m,saidas:m.saidas.map(i=>i.id===item.id?{...i,paga:!i.paga}:i)}))} onEdit={()=>setEditing({kind:'saidas',item})} onDelete={()=>deleteItem('saidas',item)}/>)}<ExpenseForm value={expense} setValue={setExpense} onAdd={addExpense}/></Section>
    </section>
    </div></div></div>
  </div></main>
}

function DialogShell({titleId,onClose,className='',children}){const ref=useRef(null);useEffect(()=>{const previous=document.activeElement;const dialog=ref.current;const focusable=dialog?.querySelectorAll('button,input,select,[tabindex]:not([tabindex="-1"])');focusable?.[0]?.focus();function keys(event){if(event.key==='Escape')onClose();if(event.key==='Tab'&&focusable?.length){const first=focusable[0];const last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}}dialog?.addEventListener('keydown',keys);return()=>{dialog?.removeEventListener('keydown',keys);previous?.focus?.()}},[onClose]);return <div className="overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</div></div>}
function PendingApproval({email,requested,onLogout}){return <main className="approval-page"><div className="approval-card"><ShieldCheck aria-hidden="true"/><h1>{requested?'Conta aguardando aprovação':'Acesso ao Dividas não solicitado'}</h1><p>{requested?<>O cadastro de <strong>{email}</strong> aguarda a liberação do administrador.</>:<>Sua conta não tem acesso ao Dividas. As aprovações de cada aplicativo são separadas.</>}</p>{!requested&&<p><a href="https://comanda-garcom.vercel.app/">Abrir Comanda Garçom</a></p>}<button type="button" onClick={()=>window.location.reload()}>Verificar aprovação</button><button type="button" className="primary" onClick={onLogout}><LogOut aria-hidden="true"/> Sair</button></div></main>}
function AdminDialog({items,onApprove,onClose}){
  const [busy,setBusy]=useState(null), [message,setMessage]=useState('')
  async function approve(item){setBusy(item.app+item.user_id);setMessage('');try{await onApprove(item.user_id,item.app);setMessage('Acesso aprovado somente para '+(item.app==='comanda'?'Comanda':'Dividas')+'.')}catch{setMessage('Não foi possível aprovar. Tente novamente.')}finally{setBusy(null)}}
  return <DialogShell titleId="admin-title" onClose={onClose} className="admin-dialog"><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="admin-title">Aprovar contas</h2><p>Confira a identidade da pessoa antes de aprovar. O e-mail informado não foi verificado. Cada aprovação libera apenas o aplicativo indicado.</p>{items.length===0?<p className="empty">Nenhuma solicitação pendente.</p>:<div className="approval-list">{items.map(item=><div key={item.app+item.user_id}><span><strong>{item.app==='comanda'?'Comanda Garçom':'Dividas'}</strong><br/>{item.email}<small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></span><button type="button" disabled={!!busy} onClick={()=>approve(item)}>{busy===item.app+item.user_id?'Aprovando…':'Aprovar '+(item.app==='comanda'?'Comanda':'Dividas')}</button></div>)}</div>}<p role="status">{message}</p></DialogShell>
}
function authError(error){const text=error?.message||'Não foi possível concluir. Tente novamente.';if(/invalid login credentials/i.test(text))return'E-mail ou senha incorretos.';if(/email not confirmed/i.test(text))return'Confirme seu e-mail antes de entrar.';if(/password should be at least/i.test(text))return'A senha precisa ter pelo menos 8 caracteres.';if(/user already registered/i.test(text))return'Este e-mail já possui uma conta.';if(/rate limit|security purposes/i.test(text))return'O serviço de e-mail atingiu o limite de envio. Tente mais tarde.';return text}
function AuthDialog({onClose}){
  const [mode,setMode]=useState('login'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState(''); const [awaiting,setAwaiting]=useState(false); const [message,setMessage]=useState('')
  function changeMode(next){setMode(next);setAwaiting(false);setPassword('');setConfirm('');setMessage('')}
  async function login(){if(!email||!password){setMessage('Informe o e-mail e a senha.');return}setMessage('Entrando...');const{error}=await supabase.auth.signInWithPassword({email,password});if(error){setMessage(authError(error));return}onClose()}
  async function signup(){if(!email||password.length<8){setMessage('Use uma senha com pelo menos 8 caracteres.');return}if(password!==confirm){setMessage('As senhas não são iguais.');return}setMessage('Criando conta...');const{data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}});if(error){setMessage(authError(error));return}if(data.session){onClose();return}setAwaiting(true);setMessage('Confirme o e-mail e clique em “Já confirmei”. Depois disso, a conta aguardará aprovação do administrador.')}
  async function magic(){if(!email){setMessage('Informe o seu e-mail.');return}setMessage('Enviando...');const{error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});setMessage(error?authError(error):'Link enviado. Abra-o no navegador em que deseja entrar.')}
  async function reset(){if(!email){setMessage('Informe o seu e-mail.');return}setMessage('Enviando...');const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});setMessage(error?authError(error):'Enviamos um link para você definir uma nova senha.')}
  const submit=mode==='login'?login:mode==='signup'?(awaiting?login:signup):magic
  return <DialogShell titleId="auth-title" onClose={onClose}><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="auth-title">Sincronize seu caderno</h2><div className="auth-tabs" role="tablist" aria-label="Forma de acesso"><button type="button" className={mode==='login'?'active':''} onClick={()=>changeMode('login')}>Entrar</button><button type="button" className={mode==='signup'?'active':''} onClick={()=>changeMode('signup')}>Criar conta</button><button type="button" className={mode==='magic'?'active':''} onClick={()=>changeMode('magic')}>Link por e-mail</button></div><label>E-mail<input type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} disabled={awaiting} onChange={e=>setEmail(e.target.value)}/></label>{mode!=='magic'&&<label>Senha<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='login'?1:8} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}/></label>}{mode==='signup'&&!awaiting&&<label>Confirmar senha<input type="password" autoComplete="new-password" minLength={mode==='login'?1:8} value={confirm} onChange={e=>setConfirm(e.target.value)} onKeyDown={e=>e.key==='Enter'&&signup()}/></label>}<button type="button" className="primary" onClick={submit}>{mode==='login'?'Entrar':mode==='signup'?(awaiting?'Já confirmei':'Criar conta'):'Enviar link de acesso'}</button>{mode==='login'&&<button type="button" className="auth-secondary" onClick={reset}>Esqueci minha senha</button>}<small aria-live="polite">{message}</small></DialogShell>
}
function PasswordDialog({onClose}){const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [message,setMessage]=useState('');async function save(){if(password.length<8){setMessage('Use uma senha com pelo menos 8 caracteres.');return}if(password!==confirm){setMessage('As senhas não são iguais.');return}setMessage('Salvando...');const{error}=await supabase.auth.updateUser({password});if(error){setMessage(authError(error));return}onClose()}return <DialogShell titleId="password-title" onClose={onClose}><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="password-title">Defina sua nova senha</h2><p>Depois de salvar, você poderá entrar com esta senha em qualquer navegador.</p><label>Nova senha<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirmar senha<input type="password" autoComplete="new-password" minLength="8" value={confirm} onChange={e=>setConfirm(e.target.value)} onKeyDown={e=>e.key==='Enter'&&save()}/></label><button type="button" className="primary" onClick={save}>Salvar nova senha</button><small aria-live="polite">{message}</small></DialogShell>}
function EditDialog({edit,onSave,onClose}){
  const expense=edit.kind==='saidas'
  const [item,setItem]=useState({...edit.item})
  const [value,setValue]=useState(String(edit.item.valor).replace('.',','))
  const [error,setError]=useState('')
  const [scope,setScope]=useState('one')
  const types=expense?OUT_TYPES:IN_TYPES
  function save(){
    const valor=parseCurrency(value)
    if(!item.desc.trim()||!Number.isFinite(valor)||valor<=0){setError('Informe uma descrição e um valor válido.');return}
    if(!validInstallments(item)){setError('Confira a parcela atual e o total (até 120).');return}
    if(expense&&item.tipo==='cartao'&&cardDetailSummary(valor,item.detalhes).exceeds){setError('Os subvalores ultrapassam o total do cartão.');return}
    onSave({...item,desc:item.desc.trim(),valor},scope)
  }
  return <DialogShell titleId="edit-title" onClose={onClose} className="edit-dialog"><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X/></button><h2 id="edit-title">Editar lançamento</h2>
    <label>Descrição<input value={item.desc} onChange={e=>setItem({...item,desc:e.target.value})}/></label>
    <label>{item.tipo==='cartao'?'Total desta fatura':'Valor'}<MoneyInput inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label>Categoria<select disabled={expense&&edit.item.tipo==='cartao'} value={item.tipo} onChange={e=>setItem({...item,tipo:e.target.value,detalhes:e.target.value==='cartao'?item.detalhes:[]})}>{Object.entries(types).map(([key,type])=><option key={key} value={key}>{type[0]}</option>)}</select></label>
    {(item.tipo==='divida'||item.tipo==='devem')&&<div className="edit-grid"><label>Parcela atual<input type="number" min="1" max="120" value={item.parcelaAtual||1} onChange={e=>setItem({...item,parcelaAtual:Number(e.target.value)})}/></label><label>Total de parcelas<input type="number" min="1" max="120" value={item.parcelaTotal||1} onChange={e=>setItem({...item,parcelaTotal:Number(e.target.value)})}/></label></div>}
    {expense&&item.tipo==='cartao'&&<CardDetails total={parseCurrency(value)} details={item.detalhes||[]} onChange={detalhes=>setItem({...item,detalhes})}/>}
    {['fixa','divida','devem','cartao'].includes(edit.item.tipo)&&<label>Aplicar alterações<select value={scope} onChange={e=>setScope(e.target.value)}><option value="one">Somente este lançamento</option><option value="future">Este e os próximos pendentes</option></select><small>Os próximos já pagos ou recebidos não serão alterados.</small></label>}
    <small className="form-error" aria-live="polite">{error}</small><button type="button" className="primary" onClick={save}>Salvar alterações</button></DialogShell>
}
function HistoryDialog({items,onClose,onRestore}){return <DialogShell titleId="history-title" onClose={onClose} className="history-dialog"><button type="button" className="close" aria-label="Fechar" onClick={onClose}><X aria-hidden="true"/></button><h2 id="history-title">Histórico na nuvem</h2><p>As versões anteriores são criadas automaticamente antes de cada alteração.</p>{items.length===0?<p>Nenhuma versão anterior disponível.</p>:<div className="history-list">{items.map(item=><div key={item.id}><span>Versão {item.version}<small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></span><button type="button" onClick={()=>onRestore(item)}>Restaurar</button></div>)}</div>}</DialogShell>}
function Card({label,value,tone}){return <div className={`card ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>}
function Section({title,tone,icon,children}){return <section className={`section ${tone}`}><h2>{icon}{title}</h2><div className="rows">{children}</div></section>}
function Empty({text}){return <p className="empty">{text}</p>}
function Row({item,types,expense,onToggle,onEdit,onDelete}){const type=types[item.tipo]||['Outro','neutral'];const checked=expense?item.paga:item.recebida!==false;const action=expense?(checked?'Marcar despesa como pendente':'Marcar despesa como paga'):(checked?'Marcar entrada como pendente':'Marcar entrada como recebida');return <div className={`row-wrap ${checked?'paid':''}`}><div className="row"><button type="button" className="check" onClick={onToggle} aria-label={`${action}: ${item.desc}`} aria-pressed={checked}>{checked?'✓':''}</button><span className="description">{item.desc}</span>{item.parcelaTotal>1&&<span className="installment" aria-label={`Parcela ${item.parcelaAtual} de ${item.parcelaTotal}`}>{item.parcelaAtual}/{item.parcelaTotal}</span>}<span className={`pill ${type[1]}`}>{type[0]}</span><span className="amount-wrap"><strong className={expense?'out':'in'}>{money(item.valor)}</strong>{expense&&checked&&<span className="paid-stamp">PAGO</span>}</span><button type="button" className="edit" aria-label={`Editar ${item.desc}`} onClick={onEdit}><Pencil aria-hidden="true"/></button><button type="button" className="trash" aria-label={`Excluir ${item.desc}`} onClick={onDelete}><Trash2 aria-hidden="true"/></button></div>{expense&&item.tipo==='cartao'&&item.detalhes?.length>0&&<div className="details" aria-label={`Detalhes de ${item.desc}`}>{item.detalhes.map(detail=><div className="detail" key={detail.id}><span>{detail.desc}{detail.parcelaTotal>1&&` · ${detail.parcelaAtual}/${detail.parcelaTotal}`}</span><strong>{money(detail.valor)}</strong></div>)}</div>}</div>}
function EntryForm({value,setValue,onAdd}){return <div className="form"><input aria-label="Descrição da entrada" placeholder="Descrição (ex: salário de agosto)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/><MoneyInput aria-label="Valor da entrada" placeholder="Valor" inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/><select aria-label="Tipo da entrada" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value})}>{Object.entries(IN_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select>{value.tipo==='devem'&&<><label>Parcela atual<input aria-label="Parcela atual da entrada" type="number" min="1" max="120" value={value.parcelaAtual??1} onChange={e=>setValue({...value,parcelaAtual:e.target.value})}/></label><label>Total de parcelas<input aria-label="Total de parcelas da entrada" type="number" min="1" max="120" value={value.parcelaTotal??1} onChange={e=>setValue({...value,parcelaTotal:e.target.value})}/></label><small className="income-installment-hint">Informe o valor de cada parcela. As próximas serão criadas como entradas pendentes.</small></>}<button className="add green" onClick={onAdd}><Plus/> adicionar</button></div>}
function ExpenseForm({value,setValue,onAdd}){
  return <div className="form expense-form"><input aria-label="Descrição da saída" placeholder="Descrição (ex: Visa)" value={value.desc} onChange={e=>setValue({...value,desc:e.target.value})}/>
    <MoneyInput aria-label={value.tipo==='cartao'?'Total desta fatura':'Valor da saída'} placeholder={value.tipo==='cartao'?'Total desta fatura':'Valor'} inputMode="decimal" value={value.valor} onChange={e=>setValue({...value,valor:e.target.value})}/>
    <select aria-label="Tipo da saída" value={value.tipo} onChange={e=>setValue({...value,tipo:e.target.value,detalhes:e.target.value==='cartao'?value.detalhes:[]})}>{Object.entries(OUT_TYPES).map(([k,v])=><option key={k} value={k}>{v[0]}</option>)}</select>
    {value.tipo==='divida'&&<input aria-label="Número de parcelas" type="number" min="1" max="120" className="parcelas" value={value.parcelas} onChange={e=>setValue({...value,parcelas:e.target.value})}/>}
    <button className="add red" onClick={onAdd}><Plus/> Salvar saída</button>
    {value.tipo==='cartao'&&<CardDetails total={parseCurrency(value.valor)} details={value.detalhes} onChange={detalhes=>setValue({...value,detalhes})}/>}
  </div>
}
