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

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Variabili SUPABASE_URL o SUPABASE_ANON_KEY mancanti nel file .env — modalità offline attiva.')
  module.exports = null
  return
}

const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

console.log('[Supabase] Client creato con successo per:', supabaseUrl)
console.log('[Supabase] Diagnostica avviata. URL:', supabaseUrl)
module.exports = supabaseClient
