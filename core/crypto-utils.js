const crypto = require('crypto')
const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

function getSecretKey(chiave) {
	const secret = chiave || process.env.CRYPTO_KEY

	if (!secret) {
		throw new Error('Variabile CRYPTO_KEY mancante nel file .env')
	}

	return crypto.createHash('sha256').update(secret).digest()
}

function cifra(testo, chiave) {
	const iv = crypto.randomBytes(IV_LENGTH)
	const secretKey = getSecretKey(chiave)
	const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv)

	const encrypted = Buffer.concat([
		cipher.update(String(testo), 'utf8'),
		cipher.final(),
	])

	return Buffer.concat([iv, encrypted]).toString('base64')
}

function decifra(testoCifrato, chiave) {
	const payload = Buffer.from(testoCifrato, 'base64')

	if (payload.length <= IV_LENGTH) {
		throw new Error('Testo cifrato non valido')
	}

	const iv = payload.subarray(0, IV_LENGTH)
	const encryptedText = payload.subarray(IV_LENGTH)
	const secretKey = getSecretKey(chiave)
	const decipher = crypto.createDecipheriv(ALGORITHM, secretKey, iv)

	const decrypted = Buffer.concat([
		decipher.update(encryptedText),
		decipher.final(),
	])

	return decrypted.toString('utf8')
}

module.exports = {
	cifra,
	decifra,
}
