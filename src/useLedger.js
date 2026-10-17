import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { loadAccountAccess, loadCloudState, saveCloudState } from './lib/storage'
import { validateLedgerState } from './lib/ledger'
import { monthOf } from './lib/planning'
import { createLocalStore } from './lib/localStore'
import { createSyncEngine } from './lib/syncEngine'

const empty = () => { const month = monthOf(); return { mesesLista: [month], mesAtual: month, dados: { [month]: { entradas: [], saidas: [] } } } }
export default function useLedger() {
  const [session, setSession] = useState(undefined)
  const [state, setState] = useState(null)
  const [accountAccess, setAccess] = useState(null)
  const [status, setStatus] = useState('Carregando...')
  const [conflict, setConflict] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [recovery, setRecovery] = useState(0)
  const [loadedOwner, setLoadedOwner] = useState(undefined)
  const engine = useRef(null), generation = useRef(0)
  const store = useRef(createLocalStore(localStorage)).current
  const owner = session?.user?.id || 'guest'
  const activeOwner = useRef(owner)
  activeOwner.current = owner
  useEffect(() => {
    if (!isSupabaseConfigured) { setSession(null); return }
    const { data } = supabase.auth.onAuthStateChange((event, current) => {
      // Do not call Supabase APIs inside its auth lock.
      if (event === 'PASSWORD_RECOVERY') setRecovery(n => n + 1)
      setSession(current)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (session === undefined) return
    const token = ++generation.current
    let channel
    setState(null); setAccess(null); setConflict(null); setLastSync(null); setLoadedOwner(undefined)
    const valid = () => generation.current === token
    function receive(event) {
      if (!valid()) return
      if (event.state) {
        const checked = validateLedgerState(event.state)
        if (!checked.valid) { setStatus(checked.message); return }
        setState(event.state)
      }
      if ('conflict' in event) setConflict(event.conflict)
      if (event.status) setStatus(event.status)
      if (event.lastSync) setLastSync(event.lastSync)
    }
    async function load() {
      try {
        if (owner === 'guest') {
          const cached = store.snapshot(owner)?.state
          if (cached && !validateLedgerState(cached).valid) throw new Error('Backup local inválido. Preserve seus dados antes de importar outro arquivo.')
          if (valid()) { setState(cached || empty()); setLoadedOwner(owner); setStatus('Modo local: entre para sincronizar.') }
          return
        }
        const access = await loadAccountAccess(owner)
        if (!valid()) return
        setAccess(access)
        if (!access.approved) { setState(empty()); setLoadedOwner(owner); return }
        const current = createSyncEngine({ owner, store,
          validate: next => { const checked=validateLedgerState(next); if(!checked.valid)throw new Error(checked.message) },
          remote: { load: async user => {
            const cloud = await loadCloudState(user)
            if (cloud && !validateLedgerState(cloud.state).valid) throw new Error('Dados remotos inválidos. Não foram carregados.')
            return cloud
          }, save: async (user, next, version) => {
            const checked = validateLedgerState(next)
            if (!checked.valid) throw new Error(checked.message)
            return saveCloudState(user, next, version)
          } },
          online: () => navigator.onLine, emit: receive,
        })
        engine.current = current
        await current.initialize()
        if (!valid()) { current.dispose(); return }
        setState(s => s || empty()); setLoadedOwner(owner)
        channel = supabase.channel('ledger-' + owner).on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_states', filter: 'user_id=eq.' + owner }, () => { void current.refresh() }).subscribe()
      } catch (error) { if (valid()) setStatus(error.message || 'Falha ao carregar a conta. Recarregue para tentar novamente.') }
    }
    void load()
    return () => { generation.current = token + 1; engine.current?.dispose(); engine.current = null; if (channel) void supabase.removeChannel(channel) }
  // The owner, not token refresh events, defines the isolated workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, session === undefined, store])
  useEffect(() => {
    const resume = () => { setOnline(navigator.onLine); void engine.current?.refresh() }
    const offline = () => setOnline(false)
    const timer = setInterval(resume, 30000)
    window.addEventListener('online', resume); window.addEventListener('offline', offline); window.addEventListener('focus', resume)
    const close = event => { if (engine.current?.pending()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', close)
    return () => { clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('offline', offline); window.removeEventListener('focus', resume); window.removeEventListener('beforeunload', close) }
  }, [])
  function persist(next) {
    if (loadedOwner !== owner || activeOwner.current !== owner) return false
    const checked = validateLedgerState(next)
    if (!checked.valid) { setStatus(checked.message); return false }
    try {
      if (owner === 'guest') { store.save(owner, next, null); setState(next); setStatus('Salvo neste dispositivo') }
      else if (accountAccess?.approved && engine.current) engine.current.save(next)
      else throw new Error('A conta não está pronta para salvar.')
      return true
    } catch (error) { setStatus(error.message || 'Não foi possível salvar. Exporte um backup.'); return false }
  }
  async function logout() {
    if (engine.current?.pending()) { setStatus('Há alterações pendentes. Aguarde a sincronização antes de sair; você pode exportar um backup.'); return }
    // Wait for successful sign-out; never pretend the session has ended.
    const previousEngine = engine.current
    const { error } = await supabase.auth.signOut()
    if (error) { setStatus('Não foi possível sair. Tente novamente.'); return }
    previousEngine?.dispose(); store.clear(owner); setRecovery(0)
    setSession(null)
  }
  function resolve(local) { try { engine.current?.resolve(local) } catch (error) { setStatus(error.message) } }
  return { state: loadedOwner === owner ? state : null, session, accountAccess, status, setStatus, persist, logout, online, conflict, lastSync, recovery, identityKey: owner, resolve, legacy: store.legacy() }
}
