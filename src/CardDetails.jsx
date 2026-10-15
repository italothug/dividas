import React, { useState } from 'react'
import { parseCurrency, cardDetailSummary } from './lib/ledger'
import { validInstallments } from './lib/planning'

const blank = () => ({ desc: '', valor: '', parcelaAtual: 1, parcelaTotal: 1 })
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function CardDetails({ details = [], total, onChange }) {
  const [draft, setDraft] = useState(blank)
  const [error, setError] = useState('')
  const summary = cardDetailSummary(total || 0, details)
  function add() {
    const next = { ...draft, id: draft.id || crypto.randomUUID(), desc: draft.desc.trim(), valor: parseCurrency(draft.valor), parcelaAtual: Number(draft.parcelaAtual), parcelaTotal: Number(draft.parcelaTotal) }
    if (!next.desc || !Number.isFinite(next.valor) || next.valor <= 0 || !validInstallments(next)) { setError('Informe descrição, valor positivo e parcelas entre 1 e 120 (atual ≤ total).'); return }
    onChange(draft.id ? details.map(d => d.id === draft.id ? next : d) : [...details, next])
    setDraft(blank()); setError('')
  }
  function edit(detail) {
    const match = detail.desc.match(/\s+(\d+)\/(\d+)\s*$/)
    setDraft({ ...detail, desc: match && !detail.parcelaTotal ? detail.desc.slice(0, match.index) : detail.desc, parcelaAtual: detail.parcelaAtual || Number(match?.[1]) || 1, parcelaTotal: detail.parcelaTotal || Number(match?.[2]) || 1 })
    setError(match && !detail.parcelaTotal ? 'Parcelas identificadas na descrição. Confira os números e clique em Aplicar subitem.' : '')
  }
  return <div className="detail-editor card-purchases">
    <strong>Compras do cartão</strong><p>O valor abaixo é de <strong>uma parcela</strong>. Informe a atual e o total: 2 de 4 cria também 3/4 e 4/4 nos próximos meses. Use 1 de 1 para uma compra à vista.</p>
    <div className="purchase-fields">
      <label>Subdescrição<input value={draft.desc} maxLength={200} placeholder="Ex.: máquina" onChange={e => setDraft({ ...draft, desc: e.target.value })}/></label>
      <label>Valor da parcela (R$)<input inputMode="decimal" value={draft.valor} onChange={e => setDraft({ ...draft, valor: e.target.value })}/></label>
      <label>Parcela atual<input type="number" min="1" max="120" value={draft.parcelaAtual} onChange={e => setDraft({ ...draft, parcelaAtual: e.target.value })}/></label>
      <label>Total de parcelas<input type="number" min="1" max="120" value={draft.parcelaTotal} onChange={e => setDraft({ ...draft, parcelaTotal: e.target.value })}/></label>
    </div><div className="debt-actions"><button type="button" onClick={add}>{draft.id ? 'Aplicar subitem' : '+ Incluir compra'}</button>{draft.id && <button type="button" onClick={() => setDraft(blank())}>Cancelar edição</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <small className={summary.exceeds ? 'detail-warning' : ''}>Detalhado nesta fatura: {money(summary.detailed)} · Não detalhado: {money(Math.max(0, summary.remaining))}{summary.exceeds && ' — ajuste o total da fatura antes de salvar.'}</small>
    {details.map(d => <div className="detail-preview" key={d.id}><span>{d.desc}{d.parcelaTotal > 1 && ` · ${d.parcelaAtual}/${d.parcelaTotal}`}</span><strong>{money(d.valor)}</strong><button type="button" aria-label={`Editar compra ${d.desc}`} onClick={() => edit(d)}>Editar</button><button type="button" aria-label={`Remover compra ${d.desc}`} onClick={() => { onChange(details.filter(item => item.id !== d.id)); if (draft.id === d.id) setDraft(blank()) }}>×</button></div>)}
    <p>Ao salvar a fatura, as parcelas futuras serão atualizadas. Faturas pagas são preservadas. Edite cada compra antiga com “2/4” no nome para confirmar seu parcelamento.</p>
  </div>
}
