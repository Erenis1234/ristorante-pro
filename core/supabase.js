let client = null
try {
  client = require('../supabaseClient')
} catch (_) {
  console.warn('[Supabase] supabaseClient non trovato, modalità offline attiva.')
}
module.exports = client
