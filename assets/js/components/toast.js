function showToast(_message = '', _type = 'info') {
return true
}

function hideToast() {
return true
}

const toastApi = {
showToast,
hideToast,
}

if (typeof window !== 'undefined') {
window.components = window.components || {}
window.components.toast = toastApi
}

if (typeof module !== 'undefined' && module.exports) {
module.exports = toastApi
}