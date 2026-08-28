import type { EngineInfo, GoOptions, EngineResult, NetStatus } from '@shared/types'
import { WebEngine } from './engine'
import { WebPuzzles } from './puzzles'
import { WebProfile } from './profile'

/** The exact surface the Electron preload exposes, taken from its global. */
type ChessApi = Window['chess']

/**
 * Builds the same `window.chess` object the Electron preload exposes, so the
 * entire renderer runs unchanged in a browser.
 *
 * Three things differ underneath:
 *  - the engine is a WASM Web Worker rather than a native process over stdio,
 *  - puzzles come from sharded JSON rather than SQLite,
 *  - the profile lives in IndexedDB rather than a file in userData.
 *
 * Networked play against friends has no browser equivalent — it needs a
 * listening TCP socket and UDP multicast — so the Friends screen is removed
 * from the web build and these methods reject rather than pretend.
 */

const PUZZLE_BASE = `${import.meta.env.BASE_URL}puzzles/`
const ENGINE_SCRIPT = `${import.meta.env.BASE_URL}engine/stockfish.js`

function notAvailableTraining(): Promise<never> {
  return Promise.reject(new Error('Structured training is only available in the desktop app.'))
}

function notAvailable(): Promise<never> {
  return Promise.reject(new Error('Playing a friend is only available in the desktop app.'))
}

const OFFLINE: NetStatus = { role: 'idle', state: 'offline' }

export async function installWebPlatform(): Promise<void> {
  const engine = new WebEngine(ENGINE_SCRIPT)
  const puzzles = new WebPuzzles(PUZZLE_BASE)
  const profile = new WebProfile()

  await profile.load()

  // Two searches never overlap in this build — there is one worker and one
  // engine — so play, analysis, and review all address the same instance.
  // `abort` therefore ignores which slot the caller named.
  const infoListeners = new Set<(info: EngineInfo) => void>()
  engine.onInfo((info) => {
    for (const listener of infoListeners) listener(info)
  })

  const api: ChessApi = {
    engine: {
      go: (options: GoOptions): Promise<EngineResult> => engine.go(options),
      analyse: (options: GoOptions): Promise<EngineResult> => engine.go(options),
      evaluate: (options: GoOptions): Promise<EngineResult> => engine.go(options),
      abort: async (): Promise<void> => engine.abort(),
      onInfo: (cb) => {
        infoListeners.add(cb)
        return () => infoListeners.delete(cb)
      }
    },

    puzzles: {
      find: (query) => puzzles.find(query),
      byId: (id) => puzzles.byId(id),
      daily: (date) => puzzles.dailyPuzzle(date),
      stats: () => puzzles.stats(),
      available: () => puzzles.available(),
      // The opening index lives in the SQLite database, which the web export
      // does not carry. The Train screen is hidden here for the same reason.
      openings: async () => []
    },

    training: {
      startWoodpecker: notAvailableTraining,
      recordWoodpecker: async () => null,
      archiveWoodpecker: async () => undefined,
      recordEndgame: notAvailableTraining,
      setOpenings: async () => []
    },

    profile: {
      get: async () => profile.get(),
      updateSettings: async (patch) => profile.updateSettings(patch),
      setDisplayName: async (name) => profile.setDisplayName(name),
      recordPuzzleAttempt: async (input) => profile.recordPuzzleAttempt(input),
      recordGame: async (game) => profile.recordGame(game),
      recordDaily: async (record) => profile.recordDaily(record),
      recordLesson: async (id, correct, completion) => profile.recordLesson(id, correct, completion),
      saveGameAnalysis: async (gameId, analysis) => profile.saveGameAnalysis(gameId, analysis),
      deleteGame: async (gameId) => profile.deleteGame(gameId),
      dueLessons: async () => profile.dueLessons(),
      reset: async () => profile.reset(),

      // A browser cannot open a save dialog on the app's behalf, so export
      // downloads a file and import reads one the player picks.
      export: async () => {
        const name = `chess-trainer-profile-${new Date().toISOString().slice(0, 10)}.json`
        try {
          const blob = new Blob([profile.exportJson()], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = name
          link.click()
          // Revoking immediately can cancel the download in Safari.
          setTimeout(() => URL.revokeObjectURL(url), 30_000)
          return { ok: true, path: name }
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : String(err) }
        }
      },

      import: async () => {
        const file = await pickFile()
        if (!file) return { ok: false, reason: 'cancelled' }
        try {
          return { ok: true, profile: await profile.importJson(await file.text()) }
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : String(err) }
        }
      }
    },

    net: {
      host: notAvailable,
      join: notAvailable,
      send: async () => false,
      disconnect: async () => undefined,
      stop: async () => undefined,
      status: async () => OFFLINE,
      defaultPort: async () => 0,
      startScan: async () => [],
      stopScan: async () => undefined,
      onHosts: () => () => undefined,
      onStatus: () => () => undefined,
      onMessage: () => () => undefined,
      onPeerLeft: () => () => undefined,
      onError: () => () => undefined
    },

    app: {
      info: async () => ({
        version: __APP_VERSION__,
        electron: '',
        node: '',
        chrome: navigator.userAgent,
        platform: 'web',
        arch: '',
        userData: profile.persistent ? 'Browser storage (IndexedDB)' : 'Memory only — nothing is saved',
        profilePath: profile.persistent ? 'IndexedDB: chess-trainer/profile' : 'not persisted',
        puzzleDbPath: PUZZLE_BASE,
        enginePath: ENGINE_SCRIPT
      }),
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    }
  }

  ;(window as unknown as { chess: ChessApi }).chess = api

  // Web-only: the desktop build has every puzzle on disk already.
  window.chessOffline = {
    downloadAll: (onProgress) => puzzles.downloadAll(onProgress),
    status: () => puzzles.cacheStatus()
  }

  // A phone can kill a backgrounded tab without warning, so commit anything
  // still on the debounce timer as soon as the page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void profile.flush()
  })
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    // Safari fires no event when the picker is dismissed; the promise simply
    // never settles, which the caller treats as "still choosing".
    input.click()
  })
}
