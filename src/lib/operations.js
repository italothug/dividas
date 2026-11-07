import { addMonths, ensureMonths } from './planning.js'
const origin = item => item.origemId || item.id
const paid = (kind, item) => kind === 'saidas' ? item.paga === true : item.recebida !== false
export function postponeIncome(state, month, itemId) {
  const index = state.dados[month]?.entradas.findIndex(item => item.id === itemId) ?? -1
  const item = state.dados[month]?.entradas[index]
  if (!item || item.tipo !== 'devem' || item.recebida !== false) throw new Error('Somente entradas pendentes de Devedor podem ser transferidas.')
  const target = addMonths(month)
  if (target > '2100-12') throw new Error('Não é possível transferir além de dezembro de 2100.')
  if (state.dados[target]?.entradas.some(entry => entry.id === itemId)) throw new Error('Este lançamento já existe no próximo mês.')
  // Generate the normal next installment before moving this overdue occurrence.
  const next = ensureMonths(state, month, target)
  const moved = { ...item, adiada: true, origemId: `adiada:${item.id}` }
  const cancellation = { id: crypto.randomUUID(), kind: 'entradas', origin: origin(item), from: month, to: month }
  return {
    state: { ...next, dados: { ...next.dados,
      [month]: { ...next.dados[month], entradas: next.dados[month].entradas.filter(entry => entry.id !== itemId) },
      [target]: { ...next.dados[target], entradas: [...next.dados[target].entradas, moved] },
    }, cancellations: [...(state.cancellations || []), cancellation] },
    undo: { type: 'postpone', month, target, item: structuredClone(item), moved: structuredClone(moved), index, cancellationId: cancellation.id, label: item.desc },
  }
}
export function undoPostponement(state, action) {
  const source = state.dados[action.month], target = state.dados[action.target]
  const moved = target?.entradas.find(item => item.id === action.item.id)
  if (!source || !target || source.entradas.some(item => item.id === action.item.id) || JSON.stringify(moved) !== JSON.stringify(action.moved)) throw new Error('O lançamento ou o mês mudou. Revise os dados antes de transferi-lo de volta.')
  const entries = [...source.entradas]
  entries.splice(Math.min(action.index, entries.length), 0, action.item)
  return { ...state, dados: { ...state.dados,
    [action.month]: { ...source, entradas: entries },
    [action.target]: { ...target, entradas: target.entradas.filter(item => item.id !== action.item.id) },
  }, cancellations: (state.cancellations || []).filter(c => c.id !== action.cancellationId) }
}
export function deleteEntries(state, month, kind, item, scope = 'one') {
  const removed = [], dados = { ...state.dados }
  for (const key of state.mesesLista) {
    if (key < month || (scope === 'one' && key !== month)) continue
    const entries = dados[key][kind]
    const keep = entries.filter((entry, index) => {
      const matches = key === month ? entry.id === item.id : origin(entry) === origin(item) && !paid(kind, entry)
      if (matches) removed.push({ month: key, kind, item: entry, index })
      return !matches
    })
    dados[key] = { ...dados[key], [kind]: keep }
  }
  const cancellation = { id: crypto.randomUUID(), kind, origin: origin(item), from: month, to: scope === 'one' ? month : '2100-12' }
  return { state: { ...state, dados, cancellations: [...(state.cancellations || []), cancellation] }, undo: { removed, cancellationId: cancellation.id, label: item.desc } }
}
export function undoDeletion(state, action) {
  const dados = { ...state.dados }
  for (const removed of action.removed) {
    const month = dados[removed.month]
    if (!month || month[removed.kind].some(item => item.id === removed.item.id)) continue
    const items = [...month[removed.kind]]
    items.splice(Math.min(removed.index, items.length), 0, removed.item)
    dados[removed.month] = { ...month, [removed.kind]: items }
  }
  return { ...state, dados, cancellations: (state.cancellations || []).filter(c => c.id !== action.cancellationId) }
}
export function editEntries(state, month, kind, previous, item, scope = 'one') {
  let next = { ...state, dados: { ...state.dados, [month]: { ...state.dados[month], [kind]: state.dados[month][kind].map(i => i.id === previous.id ? item : i) } } }
  if (scope !== 'future') return next
  const start = item.parcelaAtual || 1, total = item.parcelaTotal || 1
  const repeating = !item.adiada && (item.tipo === 'fixa' || (kind === 'entradas' ? item.tipo === 'devem' : item.tipo === 'divida'))
  for (const key of state.mesesLista.filter(m => m > month)) {
    const [y, m] = key.split('-').map(Number), [sy, sm] = month.split('-').map(Number)
    const number = start + (y - sy) * 12 + m - sm
    next.dados[key] = { ...next.dados[key], [kind]: next.dados[key][kind].flatMap(entry => {
      if (origin(entry) !== origin(previous) || paid(kind, entry)) return [entry]
      if (!repeating || (item.tipo !== 'fixa' && number > total)) return []
      return [{ ...entry, desc: item.desc, valor: item.valor, tipo: item.tipo, parcelaAtual: item.tipo === 'fixa' ? 1 : number, parcelaTotal: item.tipo === 'fixa' ? 1 : total }]
    }) }
  }
  if (repeating) next = ensureMonths(next, month, item.tipo === 'fixa' ? state.mesesLista.at(-1) : addMonths(month, total - start))
  return next
}
export function backupSummary(state) {
  return { months: state.mesesLista.length, entries: Object.values(state.dados).reduce((sum, m) => sum + m.entradas.length + m.saidas.length, 0), debtors: state.devedores?.length || 0 }
}
