import { app, ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { EnginePool } from './engine.js'
import { PuzzleDb } from './db.js'
import { ProfileStore } from './profile.js'
import { enginePath, puzzleDbPath } from './paths.js'
import { NetPlay, DEFAULT_PORT, type HostOptions, type JoinOptions } from './netplay.js'
import { Scanner } from './discovery.js'
import type { GoOptions, NetMessage, PuzzleQuery, Settings } from '../shared/types.js'

/**
 * Wires the renderer's API surface to the main-process services.
 *
 * Every handler is registered here rather than scattered across modules so the
 * full privileged surface is visible in one place — the renderer can do exactly
 * these things and nothing else.
 */
export function registerIpc(getWindow: () => BrowserWindow | null): () => Promise<void> {
  const profile = new ProfileStore()
  const settings = profile.get().settings

  const pool = new EnginePool({
    binaryPath: enginePath(),
    threads: settings.engineThreads,
    hashMb: settings.engineHashMb
  })

  // The puzzle database is large and optional at first launch, so a missing or
  // unreadable file degrades the puzzle features instead of killing the app.
  let puzzles: PuzzleDb | null = null
  let puzzleError: string | null = null
  try {
    puzzles = new PuzzleDb(puzzleDbPath())
  } catch (err) {
    puzzleError = err instanceof Error ? err.message : String(err)
    console.error('Puzzle database unavailable:', puzzleError)
  }

  const requirePuzzles = (): PuzzleDb => {
    if (!puzzles) throw new Error(puzzleError ?? 'Puzzle database unavailable')
    return puzzles
  }

  // ------------------------------------------------------------- engine ---

  ipcMain.handle('engine:go', async (_e, options: GoOptions) => {
    const engine = await pool.get('play')
    return engine.go(options)
  })

  /**
   * Analysis streams `info` back to the renderer as the search deepens, so the
   * eval bar and principal variations update live rather than snapping into
   * place when the search ends.
   */
  ipcMain.handle('engine:analyse', async (_e, options: GoOptions) => {
    const engine = await pool.get('analysis')
    const onInfo = (info: unknown): void => {
      getWindow()?.webContents.send('engine:info', info)
    }
    engine.on('info', onInfo)
    try {
      return await engine.go(options)
    } finally {
      engine.off('info', onInfo)
    }
  })

  /** One-shot evaluation used by game review; never streams. */
  ipcMain.handle('engine:evaluate', async (_e, options: GoOptions) => {
    const engine = await pool.get('review')
    return engine.go(options)
  })

  ipcMain.handle('engine:abort', async (_e, which: 'play' | 'analysis' | 'review') => {
    const engine = await pool.get(which)
    await engine.abort()
  })

  // ------------------------------------------------------------ puzzles ---

  ipcMain.handle('puzzles:find', (_e, query: PuzzleQuery) => requirePuzzles().find(query))
  ipcMain.handle('puzzles:byId', (_e, id: string) => requirePuzzles().getById(id))
  ipcMain.handle('puzzles:daily', (_e, date: string) => requirePuzzles().daily(date))
  ipcMain.handle('puzzles:stats', () => requirePuzzles().stats())
  ipcMain.handle('puzzles:available', () => ({ ok: puzzles != null, error: puzzleError }))

  // ------------------------------------------------------------ profile ---

  ipcMain.handle('profile:get', () => profile.get())
  ipcMain.handle('profile:updateSettings', (_e, patch: Partial<Settings>) => {
    const next = profile.updateSettings(patch)
    // Engine tuning only takes effect on the next engine start; restarting the
    // pool here would interrupt a game in progress.
    return next
  })
  ipcMain.handle('profile:setDisplayName', (_e, name: string) => {
    profile.setDisplayName(name)
    return profile.get()
  })
  ipcMain.handle('profile:recordPuzzleAttempt', (_e, input: Parameters<ProfileStore['recordPuzzleAttempt']>[0]) =>
    profile.recordPuzzleAttempt(input)
  )
  ipcMain.handle('profile:recordGame', (_e, game: Parameters<ProfileStore['recordGame']>[0]) =>
    profile.recordGame(game)
  )
  ipcMain.handle('profile:recordDaily', (_e, record: Parameters<ProfileStore['recordDaily']>[0]) =>
    profile.recordDaily(record)
  )
  ipcMain.handle('profile:recordLesson', (_e, id: string, correct: boolean, completion?: number) =>
    profile.recordLesson(id, correct, completion)
  )
  ipcMain.handle('profile:saveGameAnalysis', (_e, gameId: string, analysis: Parameters<ProfileStore['saveGameAnalysis']>[1]) =>
    profile.saveGameAnalysis(gameId, analysis)
  )
  ipcMain.handle('profile:deleteGame', (_e, gameId: string) => profile.deleteGame(gameId))
  ipcMain.handle('profile:dueLessons', () => profile.dueLessons())
  ipcMain.handle('profile:reset', () => profile.reset())

  ipcMain.handle('profile:export', async () => {
    const win = getWindow()
    if (!win) return { ok: false as const, reason: 'no-window' }
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export profile',
      defaultPath: `chess-trainer-profile-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false as const, reason: 'canceled' }
    await writeFile(filePath, profile.export(), 'utf8')
    return { ok: true as const, path: filePath }
  })

  ipcMain.handle('profile:import', async () => {
    const win = getWindow()
    if (!win) return { ok: false as const, reason: 'no-window' }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import profile',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || filePaths.length === 0) return { ok: false as const, reason: 'canceled' }
    try {
      const json = await readFile(filePaths[0], 'utf8')
      return { ok: true as const, profile: profile.import(json) }
    } catch (err) {
      return { ok: false as const, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  // ------------------------------------------------------------ netplay ---

  // A single connection at a time, owned by the main process so it survives
  // the renderer navigating between views mid-game.
  const net = new NetPlay()

  const forward = (channel: string) => (payload: unknown) => {
    getWindow()?.webContents.send(channel, payload)
  }
  net.on('status', forward('net:status'))
  net.on('message', forward('net:message'))
  net.on('peer-left', forward('net:peer-left'))
  net.on('error', (err: Error) => {
    getWindow()?.webContents.send('net:error', err.message)
  })

  ipcMain.handle('net:host', (_e, options: HostOptions) => net.host(options))
  ipcMain.handle('net:join', (_e, options: JoinOptions) => net.join(options))
  ipcMain.handle('net:send', (_e, msg: NetMessage) => net.send(msg))
  ipcMain.handle('net:disconnect', () => net.disconnect('closed by player'))
  ipcMain.handle('net:stop', () => net.stop())
  ipcMain.handle('net:status', () => net.getStatus())
  ipcMain.handle('net:defaultPort', () => DEFAULT_PORT)

  // Scanning only runs while the Join screen is open; it is stopped on leaving
  // so an idle app is not chattering on the network.
  const scanner = new Scanner()
  scanner.on('hosts', (hosts: unknown) => {
    getWindow()?.webContents.send('net:hosts', hosts)
  })

  ipcMain.handle('net:startScan', async () => {
    await scanner.start()
    return scanner.list()
  })
  ipcMain.handle('net:stopScan', () => scanner.stop())

  // ---------------------------------------------------------------- app ---

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    profilePath: profile.filePath,
    puzzleDbPath: puzzles?.filePath ?? null,
    enginePath: enginePath()
  }))

  /**
   * Opening external links is funnelled through the main process and limited to
   * http(s), so a crafted link in puzzle data can never launch a local handler.
   */
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Refusing to open non-web URL: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  })

  return async () => {
    profile.saveNow()
    puzzles?.close()
    await net.stop()
    await scanner.stop()
    await pool.shutdown()
  }
}
