import { app } from 'electron'
import { join } from 'node:path'

/**
 * Resolves bundled resources in both dev and packaged builds.
 *
 * In development the files sit under `resources/` at the project root, with the
 * engine split per platform since each needs its own native binary. Once
 * packaged, electron-builder copies only the relevant platform's engine to
 * `<resources>/engine`, so the subdirectory disappears.
 */
function resourceDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function enginePath(): string {
  const windows = process.platform === 'win32'
  const binary = windows ? 'stockfish.exe' : 'stockfish'
  if (app.isPackaged) return join(resourceDir(), 'engine', binary)
  return join(resourceDir(), 'engine', windows ? 'win' : 'linux', binary)
}

export function puzzleDbPath(): string {
  return join(resourceDir(), 'puzzles.db')
}
