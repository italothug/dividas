import React from 'react'
import { parseCurrency } from './lib/ledger'
export default function MoneyInput({value,onChange,...props}) {
  const amount=parseCurrency(value)
  const formatted=Number.isFinite(amount)?amount.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):null
  return <input {...props} value={value} inputMode="decimal" title={formatted?'Valor interpretado: R$ '+formatted:'Informe um valor como 1.000,00'} onChange={onChange} onBlur={()=>{if(formatted)onChange({target:{value:formatted}})}}/>
}
