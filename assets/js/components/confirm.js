function askConfirm(_message = '') {
return true
}

const confirmApi = {
askConfirm,
}

if (typeof window !== 'undefined') {
window.components = window.components || {}
window.components.confirm = confirmApi
}

if (typeof module !== 'undefined' && module.exports) {
module.exports = confirmApi
}