'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristorante-pro-auth-test-'))
const electronPath = require.resolve('electron')
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => tmpDir } },
}

const assert = require('node:assert/strict')
const { test } = require('node:test')

const {
  getPasswordRecoveryErrorMessage,
  getPasswordRecoveryLinkErrorMessage,
  getPasswordResetSessionErrorMessage,
  getPasswordUpdateErrorMessage,
  normalizeLoginIdentifier,
  parsePasswordRecoveryLink,
  recuperaPassword,
} = require('./auth')

test('mappa errori di rete a un messaggio utente chiaro', () => {
  const message = getPasswordRecoveryErrorMessage(new Error('fetch failed'))
  assert.match(message, /connessione internet/i)
})

test('mappa errori di accesso/authorization a una guida su Supabase', () => {
  const message = getPasswordRecoveryErrorMessage({ status: 403, message: 'Access denied' })
  assert.match(message, /Supabase/i)
  assert.match(message, /Site URL|Redirect URLs|email provider/i)
})

test('mappa errori Resend su dominio gmail non verificato a un messaggio chiaro', () => {
  const message = getPasswordRecoveryErrorMessage({
    status: 500,
    message: 'gomail: could not send email 1: 550 "The gmail.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"',
  })
  assert.match(message, /dominio mittente verificato/i)
  assert.match(message, /Resend/i)
})

test('mappa i rate limit di Supabase a un messaggio di attesa', () => {
  const message = getPasswordRecoveryErrorMessage({ status: 429, message: 'For security purposes, you can only request this after 17 seconds.' })
  assert.match(message, /temporaneamente bloccato/i)
  assert.match(message, /17/i)
})

test('genera un messaggio di cooldown per richieste ravvicinate', () => {
  const message = require('./auth').buildPasswordResetCooldownErrorMessage()
  assert.match(message, /temporaneamente bloccato/i)
  assert.match(message, /\d+/)
})

test('costruisce un risultato strutturato per il reset password', () => {
  const result = require('./auth').buildPasswordRecoveryResult(false, 'Errore test')
  assert.equal(result.success, false)
  assert.equal(result.message, 'Errore test')
})

test('restituisce un errore chiaro se il reset password riceve un indirizzo email non valido', async () => {
  const result = await recuperaPassword('telefono')
  assert.equal(result.success, false)
  assert.match(result.message, /indirizzo email valido/i)
})

test('normalizza un numero di telefono come identificatore di accesso', () => {
  const result = normalizeLoginIdentifier('+39 333 1234567')
  assert.equal(result.type, 'phone')
  assert.equal(result.value, '+393331234567')
})

test('normalizza un indirizzo email come identificatore di accesso', () => {
  const result = normalizeLoginIdentifier(' Chef@Example.com ')
  assert.equal(result.type, 'email')
  assert.equal(result.value, 'chef@example.com')
})

test('preserva un messaggio generico quando non è riconosciuto', () => {
  const message = getPasswordRecoveryErrorMessage({ status: 400, message: 'User not found' })
  assert.equal(message, 'User not found')
})

test('legge i token di recovery dal deep link Supabase per Electron', () => {
  const result = parsePasswordRecoveryLink('ristorantepro://reset-password#access_token=token123&refresh_token=refresh456&type=recovery')
  assert.equal(result.protocol, 'ristorantepro:')
  assert.equal(result.accessToken, 'token123')
  assert.equal(result.refreshToken, 'refresh456')
  assert.equal(result.type, 'recovery')
})

test('decodifica errori di recovery presenti nel deep link', () => {
  const linkData = parsePasswordRecoveryLink('ristorantepro://reset-password#error=access_denied&error_description=Link+expired')
  const message = getPasswordRecoveryLinkErrorMessage(linkData)
  assert.match(message, /scaduto/i)
})

test('mappa sessioni di reset non valide a un messaggio chiaro', () => {
  const message = getPasswordResetSessionErrorMessage({ status: 401, message: 'Invalid Refresh Token: Already Used' })
  assert.match(message, /sessione di reset password/i)
})

test('mappa password deboli a un messaggio chiaro', () => {
  const message = getPasswordUpdateErrorMessage({ message: 'Password should be at least 6 characters' })
  assert.match(message, /troppo debole/i)
})
