import type {
  GameAnalysis,
  GameRecord,
  LessonProgress,
  Profile,
  PuzzleAttempt,
  RatingRecord,
  Settings,
  TimeCategory
} from '@shared/types'

/**
 * Profile storage for the web build.
 *
 * The desktop app keeps one JSON document in Electron's userData directory.
 * A browser has no such place, so the same document lives in IndexedDB — chosen
 * over localStorage because a profile with a thousand games and five thousand
 * puzzle attempts will comfortably exceed localStorage's ~5MB ceiling.
 *
 * The Glicko maths is duplicated from the main process rather than shared,
 * because that module imports Electron and cannot be pulled into a browser
 * bundle. The two must stay in step; the constants below are the only numbers
 * that matter.
 */

const DB_NAME = 'chess-trainer'
const STORE = 'profile'
const KEY = 'default'
const PROFILE_VERSION = 1

const MAX_ATTEMPTS = 5000
const MAX_GAMES = 1000

const PACES: TimeCategory[] = ['untimed', 'bullet', 'blitz', 'rapid', 'classical']

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  boardThemeId: 'slate',
  boardColorOverrides: {},
  pieceSetId: 'cburnett',
  pieceColors: {
    enabled: false,
    white: { piece: '#f7f3ea', outline: '#1c1c1c' },
    black: { piece: '#2a2a2e', outline: '#e8e8ea' },
    tintAccents: false
  },
  // Phones are small; the board is resized to the viewport at runtime anyway.
  boardSize: 360,
  showCoordinates: true,
  showLegalMoves: true,
  highlightLastMove: true,
  animationMs: 180,
  soundEnabled: true,
  soundVolume: 0.6,
  autoPromoteToQueen: false,
  moveInput: 'both',
  showEvalBar: true,
  // Both are fixed by the browser engine build; kept for shape compatibility.
  engineThreads: 1,
  engineHashMb: 16,
  confirmResign: true,
  timeControlId: 'untimed',
  lowTimeWarningSec: 10
}

function newRating(rating = 1200, rd = 350): RatingRecord {
  return { rating, rd, plays: 0 }
}

function newPaceRatings(rating = 1200): Profile['paceRatings'] {
  return Object.fromEntries(PACES.map((p) => [p, newRating(rating)])) as Profile['paceRatings']
}

function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    displayName: 'Player',
    puzzleRating: newRating(1200),
    playRating: newRating(1200),
    paceRatings: newPaceRatings(),
    themeRatings: {},
    attempts: [],
    games: [],
    lessons: {},
    daily: {},
    streak: { current: 0, longest: 0, lastDate: null },
    settings: { ...DEFAULT_SETTINGS }
  }
}

// --- Glicko-1, matching the desktop implementation exactly ------------------

const Q = Math.log(10) / 400

function gFactor(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI))
}

function expectedScore(rating: number, oppRating: number, oppRd: number): number {
  return 1 / (1 + Math.pow(10, (-gFactor(oppRd) * (rating - oppRating)) / 400))
}

function glickoUpdate(
  player: RatingRecord,
  oppRating: number,
  oppRd: number,
  score: number
): RatingRecord {
  const g = gFactor(oppRd)
  const e = expectedScore(player.rating, oppRating, oppRd)
  const denom = 1 / (player.rd * player.rd) + Q * Q * g * g * e * (1 - e)
  return {
    rating: Math.max(400, Math.min(3000, Math.round(player.rating + (Q / denom) * g * (score - e)))),
    rd: Math.max(45, Math.min(350, Math.round(Math.sqrt(1 / denom)))),
    plays: player.plays + 1
  }
}

// --- storage ----------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

export class WebProfile {
  private data: Profile = defaultProfile()
  private db: IDBDatabase | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  async load(): Promise<Profile> {
    try {
      this.db = await openDb()
      const stored = await new Promise<Profile | undefined>((resolve, reject) => {
        const tx = this.db!.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(KEY)
        req.onsuccess = () => resolve(req.result as Profile | undefined)
        req.onerror = () => reject(req.error)
      })

      if (stored) {
        const base = defaultProfile()
        this.data = {
          ...base,
          ...stored,
          settings: {
            ...base.settings,
            ...(stored.settings ?? {}),
            pieceColors: { ...base.settings.pieceColors, ...(stored.settings?.pieceColors ?? {}) }
          },
          paceRatings: {
            ...newPaceRatings(stored.playRating?.rating ?? 1200),
            ...(stored.paceRatings ?? {})
          },
          version: PROFILE_VERSION
        }
      }
    } catch {
      // Private browsing can refuse IndexedDB outright. Carry on in memory
      // rather than failing to start; nothing persists, which the Settings
      // screen reports rather than leaving as a silent surprise.
      this.db = null
    }
    return this.data
  }

  get(): Profile {
    return this.data
  }

  get persistent(): boolean {
    return this.db != null
  }

  private schedule(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 400)
  }

  async flush(): Promise<void> {
    if (!this.db) return
    await new Promise<void>((resolve) => {
      const tx = this.db!.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(this.data, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.schedule()
    return this.data.settings
  }

  setDisplayName(name: string): Profile {
    this.data.displayName = name.slice(0, 40) || 'Player'
    this.schedule()
    return this.data
  }

  recordPuzzleAttempt(input: {
    puzzleId: string
    puzzleRating: number
    puzzleRd: number
    themes: string[]
    solved: boolean
    ms: number
    hints: number
  }): PuzzleAttempt {
    const score = input.solved && input.hints === 0 ? 1 : 0
    const before = this.data.puzzleRating.rating
    this.data.puzzleRating = glickoUpdate(
      this.data.puzzleRating,
      input.puzzleRating,
      input.puzzleRd,
      score
    )

    for (const theme of input.themes) {
      const current = this.data.themeRatings[theme] ?? newRating(this.data.puzzleRating.rating)
      this.data.themeRatings[theme] = glickoUpdate(current, input.puzzleRating, input.puzzleRd, score)
    }

    const attempt: PuzzleAttempt = {
      puzzleId: input.puzzleId,
      at: new Date().toISOString(),
      solved: input.solved,
      ms: input.ms,
      hints: input.hints,
      ratingBefore: before,
      ratingAfter: this.data.puzzleRating.rating
    }
    this.data.attempts.push(attempt)
    if (this.data.attempts.length > MAX_ATTEMPTS) {
      this.data.attempts.splice(0, this.data.attempts.length - MAX_ATTEMPTS)
    }
    this.schedule()
    return attempt
  }

  recordGame(game: Omit<GameRecord, 'id' | 'at'>): GameRecord {
    const record: GameRecord = {
      ...game,
      id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString()
    }

    // Unfinished games and human opponents leave the rating alone, exactly as
    // on desktop.
    if (game.result !== '*' && game.opponentElo > 0) {
      const score =
        game.result === '1/2-1/2'
          ? 0.5
          : (game.result === '1-0') === (game.playerColor === 'w')
            ? 1
            : 0
      this.data.playRating = glickoUpdate(this.data.playRating, game.opponentElo, 80, score)
      const pace = game.timeControl?.category ?? 'untimed'
      const current = this.data.paceRatings[pace] ?? newRating(this.data.playRating.rating)
      this.data.paceRatings[pace] = glickoUpdate(current, game.opponentElo, 80, score)
    }

    this.data.games.push(record)
    if (this.data.games.length > MAX_GAMES) {
      this.data.games.splice(0, this.data.games.length - MAX_GAMES)
    }
    this.schedule()
    return record
  }

  saveGameAnalysis(gameId: string, analysis: GameAnalysis): boolean {
    const game = this.data.games.find((g) => g.id === gameId)
    if (!game) return false
    game.analysis = analysis
    this.schedule()
    return true
  }

  deleteGame(gameId: string): boolean {
    const index = this.data.games.findIndex((g) => g.id === gameId)
    if (index < 0) return false
    this.data.games.splice(index, 1)
    this.schedule()
    return true
  }

  recordDaily(record: Profile['daily'][string]): Profile['streak'] {
    const existing = this.data.daily[record.date]
    this.data.daily[record.date] = record

    if (record.solved && !existing?.solved) {
      const yesterday = new Date(new Date(record.date + 'T00:00:00').getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10)
      this.data.streak.current =
        this.data.streak.lastDate === yesterday ? this.data.streak.current + 1 : 1
      this.data.streak.longest = Math.max(this.data.streak.longest, this.data.streak.current)
      this.data.streak.lastDate = record.date
    }
    this.schedule()
    return this.data.streak
  }

  recordLesson(lessonId: string, correct: boolean, completion?: number): LessonProgress {
    const prev: LessonProgress = this.data.lessons[lessonId] ?? {
      lessonId,
      completion: 0,
      lastSeen: null,
      intervalDays: 0,
      ease: 2.5,
      correct: 0,
      attempts: 0
    }
    const ease = Math.max(1.3, prev.ease + (correct ? 0.1 : -0.25))
    const intervalDays = correct ? (prev.intervalDays === 0 ? 1 : Math.round(prev.intervalDays * ease)) : 0
    const next: LessonProgress = {
      lessonId,
      completion: completion ?? Math.max(prev.completion, correct ? prev.completion : 0),
      lastSeen: new Date().toISOString(),
      intervalDays: Math.min(intervalDays, 180),
      ease,
      correct: prev.correct + (correct ? 1 : 0),
      attempts: prev.attempts + 1
    }
    this.data.lessons[lessonId] = next
    this.schedule()
    return next
  }

  dueLessons(): string[] {
    const now = Date.now()
    return Object.values(this.data.lessons)
      .filter((l) => !l.lastSeen || now - new Date(l.lastSeen).getTime() >= l.intervalDays * 86_400_000)
      .map((l) => l.lessonId)
  }

  async reset(): Promise<Profile> {
    this.data = defaultProfile()
    await this.flush()
    return this.data
  }

  /** Export and import move a profile between devices as a file. */
  exportJson(): string {
    return JSON.stringify(this.data, null, 2)
  }

  async importJson(json: string): Promise<Profile> {
    const parsed = JSON.parse(json) as Partial<Profile>
    if (!parsed || !parsed.puzzleRating || !parsed.settings) throw new Error('Not a profile file')
    this.data = { ...defaultProfile(), ...parsed, version: PROFILE_VERSION } as Profile
    await this.flush()
    return this.data
  }
}
