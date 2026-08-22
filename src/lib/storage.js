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
  const { data, error } = await supabase.from('ledger_states').select('state, version, updated_at').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? { state: data.state, version: data.version, updatedAt: data.updated_at } : null
}

export async function saveCloudState(userId, state, expectedVersion) {
  if (!isSupabaseConfigured || !userId) return
  const nextVersion = expectedVersion == null ? 1 : expectedVersion + 1
  const query = expectedVersion == null
    ? supabase.from('ledger_states').insert({ user_id: userId, state, version: nextVersion }).select('version, updated_at').maybeSingle()
    : supabase.from('ledger_states').update({ state, version: nextVersion, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('version', expectedVersion).select('version, updated_at').maybeSingle()
  const { data, error } = await query
  if (error) throw error
  if (!data) {
    const conflict = new Error('O caderno foi alterado em outro dispositivo.')
    conflict.code = 'LEDGER_CONFLICT'
    throw conflict
  }
  return { version: data.version, updatedAt: data.updated_at }
}

export async function loadCloudHistory(userId, limit = 20) {
  if (!isSupabaseConfigured || !userId) return []
  const { data, error } = await supabase.from('ledger_state_history').select('id, version, state, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}
