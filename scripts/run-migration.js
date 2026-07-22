/**
 * Esegue la migration SQL su Supabase tramite la Management API.
 * Richiede SUPABASE_ACCESS_TOKEN nel file .env (Personal Access Token da
 * https://supabase.com/dashboard/account/tokens)
 */

const path = require('path')
const fs   = require('fs')
const envPath = path.join(__dirname, '..', '.env')
require('dotenv').config({ path: envPath })

const PROJECT_REF  = 'mpvqskyahvjmxrzfhaig'
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!ACCESS_TOKEN) {
  console.error(
    '\n[ERRORE] SUPABASE_ACCESS_TOKEN mancante nel file .env\n' +
    'Vai su https://supabase.com/dashboard/account/tokens,\n' +
    'genera un Personal Access Token e aggiungilo al .env:\n' +
    '  SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx\n'
  )
  process.exit(1)
}

const sqlFile = path.join(__dirname, '..', 'database', 'migrations', '20260401_initial_schema.sql')
const sql     = fs.readFileSync(sqlFile, 'utf8')

async function runMigration() {
  console.log(`[Migration] Connessione al progetto ${PROJECT_REF}...`)

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }

  const result = await res.json()
  console.log('[Migration] Completata con successo!')
  console.log(result)
}

runMigration().catch(err => {
  console.error('[Migration] ERRORE:', err.message)
  process.exit(1)
})
