import { validateDebtor, validInstallments, debtStatement } from './planning.js'
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

export function parseCurrency(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  let normalized
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) normalized = raw.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d+(,\d{1,2})?$/.test(raw)) normalized = raw.replace(',', '.')
  else if (/^-?\d+\.\d{1,2}$/.test(raw)) normalized = raw
  else return NaN
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN
}
const validText = (s, max = 1000) => typeof s === 'string' && !!s.trim() && s.length <= max
const validMoney = n => Number.isFinite(n) && n > 0 && n <= 1e9 && Math.abs(n * 100 - Math.round(n * 100)) < 0.0001
export function validateLedgerState(value) {
  const bad = message => ({ valid: false, message })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('O arquivo não contém um caderno válido.')
  const { mesesLista, mesAtual, dados } = value
  if (!Array.isArray(mesesLista) || !mesesLista.length || mesesLista.length > 1212 || new Set(mesesLista).size !== mesesLista.length || !mesesLista.every(key => MONTH_KEY.test(key) && key >= '2000-01' && key <= '2100-12')) return bad('A lista de meses é inválida ou duplicada.')
  if (!mesesLista.includes(mesAtual) || !dados || typeof dados !== 'object' || Array.isArray(dados) || Object.keys(dados).some(key => !mesesLista.includes(key))) return bad('O mês atual ou os dados dos meses são inválidos.')
  if (value.devedores !== undefined) {
    if (!Array.isArray(value.devedores) || value.devedores.length > 10000 || !value.devedores.every(validateDebtor) || new Set(value.devedores.map(d => d.id)).size !== value.devedores.length) return bad('Cadastro de devedores inválido ou duplicado.')
    try { value.devedores.forEach(d => debtStatement(d, [d.startMonth, ...d.payments.map(p => p.date.slice(0, 7))].sort().at(-1))) } catch (error) { return bad(error.message) }
  }
  if (value.cancellations !== undefined && (!Array.isArray(value.cancellations) || value.cancellations.some(c => !c || !validText(c.id) || !validText(c.origin) || !['entradas','saidas'].includes(c.kind) || !MONTH_KEY.test(c.from) || !MONTH_KEY.test(c.to) || c.from > c.to))) return bad('Cancelamentos inválidos.')
  for (const key of mesesLista) {
    const month = dados[key]
    if (!month || !Array.isArray(month.entradas) || !Array.isArray(month.saidas)) return bad('Mês incompleto: ' + key)
    const ids = new Set()
    for (const kind of ['entradas','saidas']) {
      if (month[kind].length > 10000) return bad('Limite de lançamentos por mês excedido.')
      for (const item of month[kind]) {
        if (!item || !validText(item.id) || ids.has(item.id) || !validText(item.desc) || !validMoney(item.valor) || !validInstallments(item)) return bad('Lançamento inválido ou duplicado em ' + key)
        ids.add(item.id)
        const types = kind === 'entradas' ? ['salario','extra','devem'] : ['fixa','investimento','cartao','divida']
        // Older backups may omit the category, but unknown explicit categories are rejected.
        if (item.tipo !== undefined && !types.includes(item.tipo)) return bad('Categoria inválida em ' + key)
        for (const flag of ['paga','recebida']) if (item[flag] !== undefined && typeof item[flag] !== 'boolean') return bad('Situação inválida em ' + key)
        if (item.detalhes !== undefined) {
          if (!Array.isArray(item.detalhes) || item.detalhes.length > 1000) return bad('Detalhamento inválido.')
          const detailIds = new Set()
          for (const detail of item.detalhes) {
            if (!detail || !validText(detail.id) || detailIds.has(detail.id) || !validText(detail.desc) || !validMoney(detail.valor) || !validInstallments(detail)) return bad('Compra inválida ou duplicada em ' + key)
            detailIds.add(detail.id)
          }
          if (cardDetailSummary(item.valor, item.detalhes).exceeds) return bad('As compras ultrapassam o valor da fatura em ' + key)
        }
      }
    }
  }
  return { valid: true, message: '' }
}

export function cardDetailSummary(total, details = []) {
  const detailed = Math.round(details.reduce((sum, item) => sum + Number(item.valor || 0), 0) * 100) / 100
  return { detailed, remaining: Math.round((Number(total || 0) - detailed) * 100) / 100, exceeds: detailed > Number(total || 0) }
}

export function financialSummary(month = { entradas: [], saidas: [] }) {
  const receivedIncome = month.entradas.filter(item => item.recebida !== false).reduce((sum, item) => sum + item.valor, 0)
  const pendingIncome = month.entradas.filter(item => item.recebida === false).reduce((sum, item) => sum + item.valor, 0)
  const paidExpenses = month.saidas.filter(item => item.paga).reduce((sum, item) => sum + item.valor, 0)
  const totalExpenses = month.saidas.reduce((sum, item) => sum + item.valor, 0)
  return {
    receivedIncome,
    pendingIncome,
    paidExpenses,
    pendingExpenses: totalExpenses - paidExpenses,
    currentBalance: receivedIncome - paidExpenses,
    projectedBalance: receivedIncome + pendingIncome - totalExpenses,
  }
}
