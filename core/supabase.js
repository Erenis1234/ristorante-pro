let client = null
try {
  client = require('../supabaseClient')
} catch (_) {
  const stack = new Error('[Supabase] require("../supabaseClient") ha fallito').stack || ''
  const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
  console.warn('[Supabase] supabaseClient non trovato, modalità offline attiva.')
  console.error('[Supabase Diagnostic] core/supabase')
  console.error('[Supabase Diagnostic] - reason: require("../supabaseClient") ha lanciato un errore')
  console.error('[Supabase Diagnostic] - fileLine:', fileLine)
  console.error('[Supabase Diagnostic] - stack:', stack)
}

if (!client) {
  const stack = new Error('[Supabase] client nullo').stack || ''
  const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
  console.warn('[Supabase] Client Supabase non disponibile, modalità offline attiva.')
  console.error('[Supabase Diagnostic] core/supabase')
  console.error('[Supabase Diagnostic] - reason: supabaseClient ha esportato null/undefined')
  console.error('[Supabase Diagnostic] - fileLine:', fileLine)
  console.error('[Supabase Diagnostic] - stack:', stack)
} else if (!client.auth) {
  const stack = new Error('[Supabase] client senza auth').stack || ''
  const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
  console.error('[Supabase] Client Supabase privo di auth, modalità offline attiva.')
  console.error('[Supabase Diagnostic] core/supabase')
  console.error('[Supabase Diagnostic] - reason: il client esportato non espone auth')
  console.error('[Supabase Diagnostic] - fileLine:', fileLine)
  console.error('[Supabase Diagnostic] - stack:', stack)
  client = null
}

module.exports = client
