// Genera i tile PNG richiesti da Microsoft Store per il pacchetto AppX/MSIX,
// partendo da un'unica immagine sorgente ad alta risoluzione.
//
// Uso:
//   node scripts/generate-store-icons.js [percorso-immagine-sorgente.png]
//
// Se il percorso non viene fornito, viene usato di default:
//   assets/images/icon-source.png
//
// Le immagini generate vengono salvate in: assets/images/store/
//
// Nota: questo script NON genera lui stesso l'artwork. Serve solo a produrre
// le dimensioni richieste (tile Store) a partire da un sorgente fornito
// dall'utente (idealmente >= 310x310px, sfondo trasparente o pieno a seconda
// del design scelto).

const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

// Dimensioni dei tile richiesti da Microsoft Store per AppX (vedi Partner Center).
// { larghezza, altezza, nomeFile }
const TILE_SIZES = [
  { width: 44, height: 44, name: 'Square44x44Logo.png' },
  { width: 71, height: 71, name: 'Square71x71Logo.png' },
  { width: 150, height: 150, name: 'Square150x150Logo.png' },
  { width: 310, height: 150, name: 'Wide310x150Logo.png' },
  { width: 310, height: 310, name: 'Square310x310Logo.png' },
]

const DEFAULT_SOURCE = path.join('assets', 'images', 'icon-source.png')
const OUTPUT_DIR = path.join('assets', 'images', 'store')

async function main() {
  const sourceArg = process.argv[2]
  const sourcePath = path.resolve(sourceArg || DEFAULT_SOURCE)

  if (!fs.existsSync(sourcePath)) {
    console.error(`[generate-store-icons] Immagine sorgente non trovata: ${sourcePath}`)
    console.error('Fornisci un\'immagine PNG ad alta risoluzione (es. 310x310 o superiore) come parametro,')
    console.error(`oppure posizionala nel percorso di default: ${DEFAULT_SOURCE}`)
    process.exitCode = 1
    return
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log(`[generate-store-icons] Sorgente: ${sourcePath}`)
  console.log(`[generate-store-icons] Output:   ${path.resolve(OUTPUT_DIR)}`)

  for (const tile of TILE_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, tile.name)
    await sharp(sourcePath)
      .resize(tile.width, tile.height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(outputPath)

    console.log(`  ✓ ${tile.name} (${tile.width}x${tile.height})`)
  }

  console.log('[generate-store-icons] Completato.')
}

main().catch((err) => {
  console.error('[generate-store-icons] Errore:', err)
  process.exitCode = 1
})
