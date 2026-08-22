import { isSupabaseConfigured, supabase } from './supabase'

const LOCAL_KEY = 'caderno-contas-estado'

export function loadLocalState() {
  const value = localStorage.getItem(LOCAL_KEY)
  return value ? JSON.parse(value) : null
}

export function saveLocalState(state) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state))
}

export async function loadCloudState(userId) {
  if (!isSupabaseConfigured || !userId) return null
  const { data, error } = await supabase.from('ledger_states').select('state').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.state ?? null
}

export async function saveCloudState(userId, state) {
  if (!isSupabaseConfigured || !userId) return
  const { error } = await supabase.from('ledger_states').upsert({ user_id: userId, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}
