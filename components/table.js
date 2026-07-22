function renderTable(_rows = []) {
return []
}

function clearTable() {
return true
}

const tableApi = {
renderTable,
clearTable,
}

if (typeof window !== 'undefined') {
window.components = window.components || {}
window.components.table = tableApi
}

if (typeof module !== 'undefined' && module.exports) {
module.exports = tableApi
}