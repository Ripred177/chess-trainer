import { app } from 'electron'
import { join } from 'node:path'

/**
 * Resolves bundled resources in both dev and packaged builds.
 *
 * In development the files sit under `resources/` at the project root; once
 * packaged, electron-builder copies them to `process.resourcesPath`. The layout
 * below that point is the same either way.
 */
function resourceDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

/**
 * The Maia-3 weights.
 *
 * Unlike the engine binary this replaced, the model is the same file on every
 * platform, so there is no per-platform subdirectory to resolve. Produce it
 * with `npm run maia:export`.
 */
export function enginePath(): string {
  return join(resourceDir(), 'engine', 'maia', 'maia3-5m.onnx')
}

export function puzzleDbPath(): string {
  return join(resourceDir(), 'puzzles.db')
}
