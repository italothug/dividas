const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

export function parseCurrency(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const raw = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '')
  if (!raw) return NaN
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN
}

export function validateLedgerState(value) {
  if (!value || typeof value !== 'object') return { valid: false, message: 'O arquivo não contém um caderno válido.' }
  const { mesesLista, mesAtual, dados } = value
  if (!Array.isArray(mesesLista) || !mesesLista.length || !mesesLista.every(key => MONTH_KEY.test(key))) return { valid: false, message: 'A lista de meses é inválida.' }
  if (!MONTH_KEY.test(mesAtual) || !mesesLista.includes(mesAtual) || !dados || typeof dados !== 'object') return { valid: false, message: 'O mês atual é inválido.' }
  for (const key of mesesLista) {
    const month = dados[key]
    if (!month || !Array.isArray(month.entradas) || !Array.isArray(month.saidas)) return { valid: false, message: `Os dados de ${key} estão incompletos.` }
    for (const item of [...month.entradas, ...month.saidas]) {
      if (!item?.id || typeof item.desc !== 'string' || !item.desc.trim() || !Number.isFinite(item.valor) || item.valor <= 0) return { valid: false, message: `Existe um lançamento inválido em ${key}.` }
      if (item.detalhes && (!Array.isArray(item.detalhes) || item.detalhes.some(detail => !detail?.id || !detail.desc?.trim() || !Number.isFinite(detail.valor) || detail.valor <= 0))) return { valid: false, message: `Existe um detalhamento inválido em ${key}.` }
    }
  }
  return { valid: true, message: '' }
}

export function cardDetailSummary(total, details = []) {
  const detailed = Math.round(details.reduce((sum, item) => sum + Number(item.valor || 0), 0) * 100) / 100
  return { detailed, remaining: Math.round((Number(total || 0) - detailed) * 100) / 100, exceeds: detailed > Number(total || 0) }
}

