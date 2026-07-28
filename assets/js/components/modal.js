function openModal(_options = {}) {
return true
}

function closeModal() {
return true
}

const modalApi = {
openModal,
closeModal,
}

if (typeof window !== 'undefined') {
window.components = window.components || {}
window.components.modal = modalApi
}

if (typeof module !== 'undefined' && module.exports) {
module.exports = modalApi
}