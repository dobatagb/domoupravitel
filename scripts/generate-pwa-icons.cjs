/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

/** Brand blue #2563eb */
function fillSolid(png, r, g, b) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = 255
    }
  }
}

function writePng(size, filePath) {
  const png = new PNG({ width: size, height: size })
  fillSolid(png, 37, 99, 235)
  return new Promise((resolve, reject) => {
    png
      .pack()
      .pipe(fs.createWriteStream(filePath))
      .on('finish', resolve)
      .on('error', reject)
  })
}

async function main() {
  const pub = path.join(__dirname, '..', 'public')
  await writePng(192, path.join(pub, 'pwa-192.png'))
  await writePng(512, path.join(pub, 'pwa-512.png'))
  console.log('Wrote public/pwa-192.png and public/pwa-512.png')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
