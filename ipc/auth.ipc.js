const { ipcMain } = require('electron')

const auth = require('../core/auth')

function registerHandler(channel, handler) {
	ipcMain.removeHandler(channel)
	ipcMain.handle(channel, handler)
}

function registerAuthIpcHandlers() {
	registerHandler('ipc-login', async (_event, email, password) => auth.login(email, password))
	registerHandler('ipc-registrati', async (_event, email, password) => auth.registrati(email, password))
	registerHandler('ipc-logout', async () => auth.logout())
	registerHandler('ipc-recupera-password', async (_event, email) => auth.recuperaPassword(email))
	registerHandler('ipc-utente-corrente', async () => auth.getUtenteCorrente())
	registerHandler('ipc-controlla-sessione', async () => auth.controllaSessione())
	registerHandler('ipc-update-profile', async (_event, profileData) => auth.updateProfile(profileData))
}

module.exports = {
	registerAuthIpcHandlers,
}
