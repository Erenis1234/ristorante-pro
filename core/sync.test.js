'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { controllaConnessione, getSupabaseConnectionStatus } = require('./sync')

test('getSupabaseConnectionStatus segnala configurazione assente quando il client non è disponibile', async () => {
  const result = await getSupabaseConnectionStatus(null)
  assert.equal(result.configured, false)
  assert.equal(result.online, false)
  assert.match(result.reason, /client/i)
})

test('getSupabaseConnectionStatus segnala online quando auth.getSession va a buon fine', async () => {
  const result = await getSupabaseConnectionStatus({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  })

  assert.equal(result.configured, true)
  assert.equal(result.online, true)
  assert.match(result.reason, /session/i)
})

test('controllaConnessione restituisce false quando il client è assente', async () => {
  const result = await controllaConnessione(null)
  assert.equal(result, false)
})
