/**
 * Rasterises the PWA icons from build/icon.svg.
 *
 * Split out from build-web-assets.mjs because this is the only step that needs
 * Electron — and therefore a display. CI has neither, so the generated icons
 * are committed and this only runs when the source SVG changes.
 *
 * Usage: npm run web:icons
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const ICON_SVG = resolve(root, 'build/icon.svg')
const ICONS_DST = resolve(root, 'src/web/public/icons')

/** Standard install icon, plus Android's maskable and iOS's touch icon. */
const ICONS = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true }
]

/**
 * Android crops maskable icons to an arbitrary shape and only guarantees the
 * centre 80%. Squaring off the corners and shrinking the artwork keeps the
 * knight inside that circle whatever shape the launcher picks.
 */
function toMaskable(svg) {
  return svg
    .replace('<rect width="100" height="100" rx="22"', '<rect width="100" height="100"')
    .replace(
      /(<circle cx="50" cy="50")/,
      '<g transform="translate(10 10) scale(0.8)"><rect x="-12.5" y="-12.5" width="125" height="125" fill="none"/>$1'
    )
    .replace('</svg>', '</g></svg>')
}

function renderIcon(svgPath, outPath, size) {
  return new Promise((resolvePromise, reject) => {
    const electron = require('electron')
    const child = spawn(
      electron,
      [resolve(root, 'scripts/icon/render-icon.mjs'), svgPath, outPath, String(size)],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`render-icon exited ${code}
${err}`))
    )
  })
}

async function main() {
  await mkdir(ICONS_DST, { recursive: true })
  const svg = await readFile(ICON_SVG, 'utf8')
  const maskableSvg = join(ICONS_DST, '.maskable.svg')
  await writeFile(maskableSvg, toMaskable(svg), 'utf8')

  for (const icon of ICONS) {
    await renderIcon(icon.maskable ? maskableSvg : ICON_SVG, join(ICONS_DST, icon.name), icon.size)
  }
  await rm(maskableSvg, { force: true })
  console.log(`
Icons written to ${ICONS_DST}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
