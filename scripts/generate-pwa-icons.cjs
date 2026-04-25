/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

/** Brand blue #2563eb (съвпада с favicon.svg) */
const BR = 37
const BG = 99
const BB = 235
const W = 255

/** House outline — същите форми като public/favicon.svg (viewBox 0 0 32 32) */
const HOUSE_32 = [
  { x: 16, y: 5.5 },
  { x: 6, y: 12.2 },
  { x: 6, y: 26 },
  { x: 12.5, y: 26 },
  { x: 12.5, y: 18 },
  { x: 19.5, y: 18 },
  { x: 19.5, y: 26 },
  { x: 26, y: 26 },
  { x: 26, y: 12.2 },
]

/** «Прозорци/врата» – синьо върху бялото, като в SVG */
const WINS_32 = [
  { x: 10, y: 14, w: 3, h: 2.5 },
  { x: 19, y: 14, w: 3, h: 2.5 },
  { x: 14, y: 20, w: 4, h: 2 },
]

function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi === yj) continue
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function inRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

function drawAppIconPng(size, filePath) {
  const png = new PNG({ width: size, height: size })
  const s = size / 32

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (size * py + px) << 2
      const x = (px + 0.5) / s
      const y = (py + 0.5) / s

      let r = BR
      let g = BG
      let b = BB

      if (pointInPolygon(x, y, HOUSE_32)) {
        r = W
        g = W
        b = W
        for (const wrect of WINS_32) {
          if (inRect(x, y, wrect)) {
            r = BR
            g = BG
            b = BB
            break
          }
        }
      }

      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = 255
    }
  }

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
  await drawAppIconPng(192, path.join(pub, 'pwa-192.png'))
  await drawAppIconPng(512, path.join(pub, 'pwa-512.png'))
  console.log('Wrote public/pwa-192.png and public/pwa-512.png (house icon, as in favicon.svg)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
