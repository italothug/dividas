import React, { useState } from 'react'
import { createLocalStore } from './lib/localStore'

export default function LegacyNotice({ backup, onDownload }) {
  const [store] = useState(() => createLocalStore(localStorage))
  const [dismissed, setDismissed] = useState(() => store.legacyNoticeDismissed())
  const [error, setError] = useState('')
  if (!backup) return null
  function dismiss() {
    try { store.dismissLegacyNotice(); setDismissed(true) }
    catch { setError('Não foi possível guardar sua preferência. Tente novamente.') }
  }
  if (dismissed) return <details className="legacy-notice"><summary>Backup antigo disponível</summary><p>O backup foi preservado neste navegador.</p><button type="button" onClick={onDownload}>Baixar backup antigo</button></details>
  return <div className="legacy-notice">
    Há um backup local da versão anterior, sem identificação de conta. Ele não foi misturado aos seus dados.{' '}
    <button type="button" onClick={onDownload}>Baixar backup antigo</button>{' '}
    Você pode revisar e importar pela opção Importar.{' '}
    <button type="button" onClick={dismiss}>Dispensar aviso</button>
    {error && <p role="alert">{error}</p>}
  </div>
}
