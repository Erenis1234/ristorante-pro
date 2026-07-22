const fs = require('fs')

const files = [
  'assets/css/base.css',
  'assets/css/login.css',
  'assets/css/layout.css',
  'assets/css/components.css',
  'assets/css/utilities.css',
]

for (const f of files) {
  let css = fs.readFileSync(f, 'utf8')

  // 1. Aggiunge -webkit-user-select prima di ogni user-select (se non già presente)
  css = css.replace(/^([ \t]*)(-webkit-user-select:[^\n]*\n)?([ \t]*)(user-select:)/gm, (m, i1, already, i2, prop) => {
    if (already) return m // prefisso già presente
    return i2 + '-webkit-user-select:' + m.slice(i2.length + prop.length) + '\n' + i2 + prop
  })

  // 2. Fix backdrop-filter: metti -webkit-backdrop-filter prima
  css = css.replace(/([ \t]*)(backdrop-filter:)([^\n]+)/g, (m, indent, prop, val) => {
    const webkit = indent + '-webkit-backdrop-filter:' + val
    const standard = indent + prop + val
    // Se il prefisso è già presente subito prima, non aggiungere
    if (css.includes(webkit + '\n' + standard)) return m
    return webkit + '\n' + standard
  })
  // Rimuovi eventuali doppi -webkit-backdrop-filter
  css = css.replace(/(-webkit-backdrop-filter:[^\n]+\n)(\s*-webkit-backdrop-filter:[^\n]+\n)/g, '$2')

  fs.writeFileSync(f, css)
  console.log('Fixed:', f)
}
