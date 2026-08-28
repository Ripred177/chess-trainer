/**
 * Copies the static assets the web build serves that are not source files.
 *
 * Vite allows a single publicDir and the desktop build already owns
 * src/renderer/public, so the piece sets are mirrored into the web public
 * directory rather than symlinked (Windows makes symlinks an administrator
 * operation, and git does not preserve them usefully). The WASM engine comes
 * straight out of node_modules.
 *
 * Both outputs are reproducible from a clean checkout, which is why they are
 * gitignored and regenerated in CI. Icons are not — see build-web-icons.mjs.
 *
 * Usage: npm run web:assets
 */

import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const PIECES_SRC = resolve(root, 'src/renderer/public/pieces')
const PIECES_DST = resolve(root, 'src/web/public/pieces')
const ENGINE_DST = resolve(root, 'src/web/public/engine')

async function main() {
  // --- pieces --------------------------------------------------------------
  await rm(PIECES_DST, { recursive: true, force: true })
  await cp(PIECES_SRC, PIECES_DST, { recursive: true })
  console.log(`  pieces  ${PIECES_DST}`)

  // --- engine --------------------------------------------------------------
  await mkdir(ENGINE_DST, { recursive: true })
  const enginePkg = dirname(require.resolve('stockfish.js/package.json'))
  for (const [from, to] of [
    ['stockfish.js', 'stockfish.js'],
    ['stockfish.wasm', 'stockfish.wasm'],
    ['stockfish.wasm.js', 'stockfish.wasm.js'],
    ['Copying.txt', 'LICENSE.txt']
  ]) {
    await cp(join(enginePkg, from), join(ENGINE_DST, to))
  }
  console.log(`  engine  ${ENGINE_DST}`)

  console.log(`\nWeb assets ready.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
