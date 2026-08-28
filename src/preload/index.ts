import { contextBridge, ipcRenderer } from 'electron'
import type {
  Color,
  DailyRecord,
  GameAnalysis,
  EngineInfo,
  EngineResult,
  GameRecord,
  GoOptions,
  LessonProgress,
  Profile,
  Puzzle,
  PuzzleAttempt,
  PuzzleQuery,
  PuzzleStats,
  Settings,
  DiscoveredHost,
  NetMessage,
  NetStatus,
  TimeControl,
  OpeningSummary,
  WoodpeckerSet,
  EndgameProgress
} from '../shared/types.js'

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  arch: string
  userData: string
  profilePath: string
  puzzleDbPath: string | null
  enginePath: string
}

/**
 * The complete surface the renderer is allowed to touch. Nothing else from
 * Node or Electron crosses the context bridge.
 */
const api = {
  engine: {
    /** Ask the opponent for its move. */
    go: (options: GoOptions): Promise<EngineResult> => ipcRenderer.invoke('engine:go', options),
    /** Deep analysis; progress arrives via `onInfo`. */
    analyse: (options: GoOptions): Promise<EngineResult> => ipcRenderer.invoke('engine:analyse', options),
    /** Single blocking evaluation, used when reviewing a finished game. */
    evaluate: (options: GoOptions): Promise<EngineResult> => ipcRenderer.invoke('engine:evaluate', options),
    abort: (which: 'play' | 'analysis' | 'review' = 'analysis'): Promise<void> =>
      ipcRenderer.invoke('engine:abort', which),
    /** Subscribe to streaming analysis updates. Returns an unsubscribe fn. */
    onInfo: (cb: (info: EngineInfo) => void): (() => void) => {
      const listener = (_e: unknown, info: EngineInfo): void => cb(info)
      ipcRenderer.on('engine:info', listener)
      return () => ipcRenderer.off('engine:info', listener)
    }
  },

  puzzles: {
    find: (query: PuzzleQuery): Promise<Puzzle[]> => ipcRenderer.invoke('puzzles:find', query),
    byId: (id: string): Promise<Puzzle | null> => ipcRenderer.invoke('puzzles:byId', id),
    /** `date` is a local YYYY-MM-DD string. */
    daily: (date: string): Promise<Puzzle | null> => ipcRenderer.invoke('puzzles:daily', date),
    stats: (): Promise<PuzzleStats> => ipcRenderer.invoke('puzzles:stats'),
    available: (): Promise<{ ok: boolean; error: string | null }> => ipcRenderer.invoke('puzzles:available'),
    /** Every opening the puzzle database has tags for, biggest first. */
    openings: (): Promise<OpeningSummary[]> => ipcRenderer.invoke('puzzles:openings')
  },

  /** Structured study: Woodpecker sets, endgame drills, opening selection. */
  training: {
    startWoodpecker: (input: {
      label: string
      puzzleIds: string[]
      minRating: number
      maxRating: number
      themes: string[]
    }): Promise<WoodpeckerSet> => ipcRenderer.invoke('training:startWoodpecker', input),
    recordWoodpecker: (input: { solved: boolean; ms: number }): Promise<WoodpeckerSet | null> =>
      ipcRenderer.invoke('training:recordWoodpecker', input),
    archiveWoodpecker: (): Promise<void> => ipcRenderer.invoke('training:archiveWoodpecker'),
    recordEndgame: (
      positionId: string,
      result: 'win' | 'draw' | 'loss',
      achieved: boolean
    ): Promise<EndgameProgress> =>
      ipcRenderer.invoke('training:recordEndgame', positionId, result, achieved),
    setOpenings: (openings: string[]): Promise<string[]> =>
      ipcRenderer.invoke('training:setOpenings', openings)
  },

  profile: {
    get: (): Promise<Profile> => ipcRenderer.invoke('profile:get'),
    updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke('profile:updateSettings', patch),
    setDisplayName: (name: string): Promise<Profile> => ipcRenderer.invoke('profile:setDisplayName', name),
    recordPuzzleAttempt: (input: {
      puzzleId: string
      puzzleRating: number
      puzzleRd: number
      themes: string[]
      solved: boolean
      ms: number
      hints: number
    }): Promise<PuzzleAttempt> => ipcRenderer.invoke('profile:recordPuzzleAttempt', input),
    recordGame: (game: Omit<GameRecord, 'id' | 'at'>): Promise<GameRecord> =>
      ipcRenderer.invoke('profile:recordGame', game),
    recordDaily: (record: DailyRecord): Promise<Profile['streak']> =>
      ipcRenderer.invoke('profile:recordDaily', record),
    recordLesson: (id: string, correct: boolean, completion?: number): Promise<LessonProgress> =>
      ipcRenderer.invoke('profile:recordLesson', id, correct, completion),
    saveGameAnalysis: (gameId: string, analysis: GameAnalysis): Promise<boolean> =>
      ipcRenderer.invoke('profile:saveGameAnalysis', gameId, analysis),
    deleteGame: (gameId: string): Promise<boolean> => ipcRenderer.invoke('profile:deleteGame', gameId),
    dueLessons: (): Promise<string[]> => ipcRenderer.invoke('profile:dueLessons'),
    reset: (): Promise<Profile> => ipcRenderer.invoke('profile:reset'),
    export: (): Promise<{ ok: boolean; path?: string; reason?: string }> => ipcRenderer.invoke('profile:export'),
    import: (): Promise<{ ok: boolean; profile?: Profile; reason?: string }> =>
      ipcRenderer.invoke('profile:import')
  },

  /** Peer-to-peer play over a local network. */
  net: {
    host: (options: {
      port: number
      displayName: string
      hostColor: Color | 'random'
      timeControl: TimeControl
    }): Promise<{ port: number; addresses: string[] }> => ipcRenderer.invoke('net:host', options),
    join: (options: { address: string; displayName: string }): Promise<void> =>
      ipcRenderer.invoke('net:join', options),
    send: (msg: NetMessage): Promise<boolean> => ipcRenderer.invoke('net:send', msg),
    disconnect: (): Promise<void> => ipcRenderer.invoke('net:disconnect'),
    stop: (): Promise<void> => ipcRenderer.invoke('net:stop'),
    status: (): Promise<NetStatus> => ipcRenderer.invoke('net:status'),
    defaultPort: (): Promise<number> => ipcRenderer.invoke('net:defaultPort'),

    /** Begin watching the local network for hosted games. */
    startScan: (): Promise<DiscoveredHost[]> => ipcRenderer.invoke('net:startScan'),
    stopScan: (): Promise<void> => ipcRenderer.invoke('net:stopScan'),
    onHosts: (cb: (hosts: DiscoveredHost[]) => void): (() => void) => {
      const l = (_e: unknown, h: DiscoveredHost[]): void => cb(h)
      ipcRenderer.on('net:hosts', l)
      return () => ipcRenderer.off('net:hosts', l)
    },

    onStatus: (cb: (status: NetStatus) => void): (() => void) => {
      const l = (_e: unknown, s: NetStatus): void => cb(s)
      ipcRenderer.on('net:status', l)
      return () => ipcRenderer.off('net:status', l)
    },
    onMessage: (cb: (msg: NetMessage) => void): (() => void) => {
      const l = (_e: unknown, m: NetMessage): void => cb(m)
      ipcRenderer.on('net:message', l)
      return () => ipcRenderer.off('net:message', l)
    },
    onPeerLeft: (cb: (reason?: string) => void): (() => void) => {
      const l = (_e: unknown, r?: string): void => cb(r)
      ipcRenderer.on('net:peer-left', l)
      return () => ipcRenderer.off('net:peer-left', l)
    },
    onError: (cb: (message: string) => void): (() => void) => {
      const l = (_e: unknown, m: string): void => cb(m)
      ipcRenderer.on('net:error', l)
      return () => ipcRenderer.off('net:error', l)
    }
  },

  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url)
  }
}

export type ChessApi = typeof api

contextBridge.exposeInMainWorld('chess', api)
