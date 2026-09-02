/**
 * Copies the static assets the web build serves that are not source files.
 *
 * Vite allows a single publicDir and the desktop build already owns
 * src/renderer/public, so the piece sets are mirrored into the web public
 * directory rather than symlinked (Windows makes symlinks an administrator
 * operation, and git does not preserve them usefully). The Maia weights come
 * from resources/, where `npm run maia:export` puts them. The onnxruntime
 * runtime is not copied here: vite emits it from the bundle.
 *
 * Both outputs are reproducible from a clean checkout, which is why they are
 * gitignored and regenerated in CI. Icons are not — see build-web-icons.mjs.
 *
 * Usage: npm run web:assets
 */

import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const PIECES_SRC = resolve(root, 'src/renderer/public/pieces')
const PIECES_DST = resolve(root, 'src/web/public/pieces')
const ENGINE_DST = resolve(root, 'src/web/public/engine')
const MAIA_SRC = resolve(root, 'resources/engine/maia')

/** The quantized model; the fp32 weights stay on the desktop side. */
const MAIA_MODEL = 'maia3-5m.int8.onnx'

async function main() {
  // --- pieces --------------------------------------------------------------
  await rm(PIECES_DST, { recursive: true, force: true })
  await cp(PIECES_SRC, PIECES_DST, { recursive: true })
  console.log(`  pieces  ${PIECES_DST}`)

  // --- engine --------------------------------------------------------------
  // Cleared first: a stale engine left here would be picked up by the service
  // worker's precache glob and shipped to every visitor.
  await rm(ENGINE_DST, { recursive: true, force: true })
  await mkdir(ENGINE_DST, { recursive: true })
  const model = join(MAIA_SRC, MAIA_MODEL)
  if (!existsSync(model)) {
    throw new Error(
      `Maia model missing at ${model}.
Run \`npm run maia:export\` before building the web assets.`
    )
  }
  await cp(model, join(ENGINE_DST, MAIA_MODEL))
  console.log(`  engine  ${ENGINE_DST}`)

  console.log(`\nWeb assets ready.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
