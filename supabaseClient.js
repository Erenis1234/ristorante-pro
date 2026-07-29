const fs = require('node:fs')
const path = require('path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

const envCandidates = []
if (process.env.NODE_ENV === 'production' && process.resourcesPath) {
  envCandidates.push(path.join(process.resourcesPath, '.env'))
}
envCandidates.push(path.join(__dirname, '.env'))
envCandidates.push(path.join(process.cwd(), '.env'))

const resolvedEnvPath = envCandidates.find(candidate => fs.existsSync(candidate)) || envCandidates[0]
console.log('[Supabase] Inizializzazione client. envPath:', resolvedEnvPath)
dotenv.config({ path: resolvedEnvPath, override: true })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
console.log('[Supabase] Variabili ambiente caricate:', {
  nodeEnv: process.env.NODE_ENV || 'development',
  url: supabaseUrl || 'n/a',
  hasAnonKey: Boolean(supabaseAnonKey),
  hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
})

function logSupabaseBootstrapDiagnostic(reason, error) {
  const stack = error?.stack || new Error(reason).stack || ''
  const fileLine = stack.split('\n').find(line => /:\d+:\d+/.test(line)) || 'n/a'
  console.error('[Supabase Diagnostic] bootstrap')
  console.error('[Supabase Diagnostic] - reason:', reason)
  console.error('[Supabase Diagnostic] - fileLine:', fileLine)
  if (error) {
    console.error('[Supabase Diagnostic] - stack:', stack)
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Variabili SUPABASE_URL o SUPABASE_ANON_KEY mancanti nel file .env — modalità offline attiva.')
  logSupabaseBootstrapDiagnostic('SUPABASE_URL o SUPABASE_ANON_KEY mancanti nel file .env')
  module.exports = null
  return
}

let supabaseClient
try {
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
} catch (error) {
  console.error('[Supabase] Errore durante la creazione del client:', error.message)
  logSupabaseBootstrapDiagnostic('createClient ha fallito', error)
  module.exports = null
  return
}

if (!supabaseClient || !supabaseClient.auth) {
  logSupabaseBootstrapDiagnostic('Client Supabase creato senza proprietà auth')
  module.exports = null
  return
}

console.log('[Supabase] Client creato con successo per:', supabaseUrl)
console.log('[Supabase] Diagnostica avviata. URL:', supabaseUrl)
module.exports = supabaseClient
