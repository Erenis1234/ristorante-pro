const path = require('path')
const dotenv = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

// In produzione il .env viene copiato in process.resourcesPath da electron-builder.
// In sviluppo si trova nella root del progetto (non in __dirname che sarebbe ./core/).
const envPath = process.env.NODE_ENV === 'production'
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '.env')

dotenv.config({ path: envPath })

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

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

module.exports = supabaseClient
