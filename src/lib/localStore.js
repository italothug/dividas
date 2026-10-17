const PREFIX = 'caderno-v2:'
export function createLocalStore(storage) {
  const key = (owner, type) => PREFIX + encodeURIComponent(owner || 'guest') + ':' + type
  function read(owner, type) {
    const raw = storage.getItem(key(owner, type))
    if (!raw) return null
    try { return JSON.parse(raw) } catch { throw new Error('Dados locais inválidos. Exporte o backup antes de limpar o navegador.') }
  }
  return {
    snapshot: owner => read(owner, 'state'),
    save: (owner, state, version) => storage.setItem(key(owner, 'state'), JSON.stringify({ state, version })),
    pending: owner => read(owner, 'pending'),
    enqueue(owner, state, baseVersion) {
      const previous = read(owner, 'pending')
      const operation = { id: crypto.randomUUID(), state, baseVersion: previous ? previous.baseVersion : baseVersion }
      storage.setItem(key(owner, 'pending'), JSON.stringify(operation))
      return operation
    },
    acknowledge(owner, operation, version) {
      const latest = read(owner, 'pending')
      if (latest?.id === operation.id) storage.removeItem(key(owner, 'pending'))
      else if (latest) storage.setItem(key(owner, 'pending'), JSON.stringify({ ...latest, baseVersion: version }))
    },
    discard: owner => storage.removeItem(key(owner, 'pending')),
    clear(owner) { storage.removeItem(key(owner, 'state')); storage.removeItem(key(owner, 'pending')) },
    legacy: () => storage.getItem('caderno-contas-estado'),
  }
}
