// One engine per identity. In-flight responses cannot mutate a replacement engine.
export function createSyncEngine({ owner, store, remote, online = () => true, emit = () => {}, validate = () => {} }) {
  let active = true, ready = false, busy = false, version = null, conflict = null
  const send = event => { if (active) emit(event) }
  async function initialize() {
    try {
      const pending = store.pending(owner)
      const cached = store.snapshot(owner)
      if (pending) validate(pending.state)
      if (cached) validate(cached.state)
      const cloud = await remote.load(owner)
      if (!active) return
      version = cloud?.version ?? null
      ready = true
      if (pending && pending.baseVersion !== version) {
        conflict = cloud || { state: null, version: null }
        send({ state: pending.state, conflict, status: 'Há alterações diferentes na nuvem. Escolha a versão que deseja manter.' })
      } else {
        const state = pending?.state || cloud?.state || cached?.state
        if (state) { store.save(owner, state, version); send({ state }) }
        send({ status: pending ? 'Alteração pendente de envio.' : 'Conectado à nuvem', conflict: null })
        await flush()
      }
    } catch (error) {
      if (!active) return
      const pending = store.pending(owner), cached = store.snapshot(owner)
      if (pending) validate(pending.state)
      if (cached) validate(cached.state)
      version = pending ? pending.baseVersion : cached?.version ?? null
      ready = !!pending || !!cached
      send({ state: pending?.state || cached?.state, status: error.message || 'Sem conexão com a nuvem.' })
    }
  }
  function save(state) {
    validate(state)
    if (!active || !ready) throw new Error('Aguarde o carregamento da conta antes de salvar.')
    const operation = store.enqueue(owner, state, version)
    store.save(owner, state, version)
    send({ state, status: online() ? 'Salvando...' : 'Salvo no dispositivo; envio pendente.' })
    void flush()
    return operation
  }
  async function flush() {
    if (!active || !ready || busy || conflict || !online()) return
    busy = true
    try {
      while (active && online() && !conflict) {
        const operation = store.pending(owner)
        if (!operation) break
        try {
          const result = await remote.save(owner, operation.state, operation.baseVersion)
          if (!active) return
          version = result.version
          store.acknowledge(owner, operation, version)
          const remaining = store.pending(owner)
          store.save(owner, remaining?.state || operation.state, version)
          send({ status: remaining ? 'Salvando alteração mais recente...' : 'Salvo na nuvem', lastSync: result.updatedAt })
        } catch (error) {
          if (!active) return
          if (error.code === 'LEDGER_CONFLICT' || error.code === '23505') {
            let cloud
            try { cloud = await remote.load(owner) } catch { send({ status: 'Conflito detectado; reconecte para carregar a versão remota.' }); break }
            if (!active) return
            conflict = cloud || { state: null, version: null }
            send({ conflict, status: 'Conflito detectado. Seus dados locais foram preservados.' })
          } else send({ status: 'Envio pendente. Tentaremos novamente sem descartar suas alterações.' })
          break
        }
      }
    } finally { busy = false }
  }
  async function refresh() {
    if (!active || busy || conflict || !online()) return
    if (!ready) { await initialize(); return }
    await flush()
    if (!active || busy || conflict || store.pending(owner)) return
    const requestedVersion = version
    try {
      const cloud = await remote.load(owner)
      if (!active || busy || store.pending(owner) || requestedVersion !== version) return
      if (cloud && cloud.version !== version) {
        version = cloud.version
        store.save(owner, cloud.state, version)
        send({ state: cloud.state, lastSync: cloud.updatedAt, status: 'Sincronizado com a nuvem' })
      }
    } catch { send({ status: 'Não foi possível atualizar a nuvem. Dados locais preservados.' }) }
  }
  function resolve(useLocal) {
    if (!active || !conflict) return
    const pending = store.pending(owner)
    version = conflict.version
    if (!useLocal && !conflict.state) throw new Error('Nenhuma versão remota disponível.')
    const state = useLocal ? pending?.state : conflict.state
    if (!state) throw new Error('Nenhuma versão local disponível.')
    store.discard(owner)
    store.save(owner, state, version)
    conflict = null
    send({ state, conflict: null, status: 'Versão escolhida.' })
    if (useLocal) save(state)
  }
  return { initialize, save, flush, refresh, resolve, pending: () => store.pending(owner), dispose() { active = false }, get busy() { return busy } }
}
