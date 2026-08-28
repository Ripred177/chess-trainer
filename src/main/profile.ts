import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type {
  DailyRecord,
  GameRecord,
  LessonProgress,
  Profile,
  PuzzleAttempt,
  RatingRecord,
  Settings,
  TimeCategory,
  GameAnalysis
} from '../shared/types.js'

const PROFILE_VERSION = 1

/** Keep history bounded so the profile file stays small and fast to parse. */
const MAX_ATTEMPTS = 5000
const MAX_GAMES = 1000

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
  boardSize: 560,
  showCoordinates: true,
  showLegalMoves: true,
  highlightLastMove: true,
  animationMs: 180,
  soundEnabled: true,
  soundVolume: 0.6,
  autoPromoteToQueen: false,
  moveInput: 'both',
  showEvalBar: true,
  engineThreads: 2,
  engineHashMb: 128,
  confirmResign: true,
  timeControlId: 'untimed',
  lowTimeWarningSec: 10
}

function newRating(rating = 1200, rd = 350): RatingRecord {
  return { rating, rd, plays: 0 }
}

const PACES: TimeCategory[] = ['untimed', 'bullet', 'blitz', 'rapid', 'classical']

/** A fresh rating for every pace, so each is tracked independently. */
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

// ----------------------------------------------------------------- rating ---

/**
 * Glicko-1 rating update for a single result.
 *
 * Puzzles are rated games against an opponent of known strength: the puzzle's
 * own Lichess rating. Rating deviation shrinks as the player solves more, so
 * early swings are large and later ones settle down — which is exactly the
 * behaviour you want from a training tool.
 */
const Q = Math.log(10) / 400

function gFactor(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI))
}

function expectedScore(rating: number, oppRating: number, oppRd: number): number {
  return 1 / (1 + Math.pow(10, (-gFactor(oppRd) * (rating - oppRating)) / 400))
}

export function glickoUpdate(
  player: RatingRecord,
  oppRating: number,
  oppRd: number,
  score: number
): RatingRecord {
  const g = gFactor(oppRd)
  const e = expectedScore(player.rating, oppRating, oppRd)
  const dSquaredInv = Q * Q * g * g * e * (1 - e)
  const denom = 1 / (player.rd * player.rd) + dSquaredInv

  const newRd = Math.sqrt(1 / denom)
  const delta = (Q / denom) * g * (score - e)

  return {
    // Clamp so a bad streak can't drive the rating somewhere meaningless.
    rating: Math.max(400, Math.min(3000, Math.round(player.rating + delta))),
    // Floor the deviation so the rating stays responsive to real improvement.
    rd: Math.max(45, Math.min(350, Math.round(newRd))),
    plays: player.plays + 1
  }
}

/**
 * Ratings drift back toward uncertainty while you are away, so a player who
 * returns after months isn't pinned to a stale number.
 */
function decayRd(record: RatingRecord, daysIdle: number): RatingRecord {
  if (daysIdle <= 0) return record
  const c = 8 // RD points regained per sqrt(day)
  const rd = Math.min(350, Math.sqrt(record.rd * record.rd + c * c * daysIdle))
  return { ...record, rd: Math.round(rd) }
}

// ------------------------------------------------------------------ store ---

/**
 * The player's profile, persisted as a single JSON document in Electron's
 * userData directory.
 *
 * Writes go to a temporary file and are renamed into place, so an interrupted
 * save can never leave a half-written profile behind.
 */
export class ProfileStore {
  private data: Profile
  private path: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor(customPath?: string) {
    this.path = customPath ?? join(app.getPath('userData'), 'profile.json')
    this.data = this.load()
  }

  private load(): Profile {
    if (!existsSync(this.path)) return defaultProfile()
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Profile>
      const base = defaultProfile()
      const merged: Profile = {
        ...base,
        ...raw,
        // Settings gain new keys between versions; fill the gaps rather than
        // dropping the player's existing choices.
        settings: {
          ...base.settings,
          ...(raw.settings ?? {}),
          // pieceColors is nested, so a shallow spread would leave a profile
          // written before it existed without its sub-keys.
          pieceColors: { ...base.settings.pieceColors, ...(raw.settings?.pieceColors ?? {}) }
        },
        puzzleRating: raw.puzzleRating ?? base.puzzleRating,
        playRating: raw.playRating ?? base.playRating,
        // Profiles written before per-pace ratings existed seed every pace
        // from the overall rating rather than starting them all at 1200.
        paceRatings: {
          ...newPaceRatings(raw.playRating?.rating ?? 1200),
          ...(raw.paceRatings ?? {})
        },
        themeRatings: raw.themeRatings ?? {},
        attempts: raw.attempts ?? [],
        games: raw.games ?? [],
        lessons: raw.lessons ?? {},
        daily: raw.daily ?? {},
        streak: raw.streak ?? base.streak,
        version: PROFILE_VERSION
      }
      return this.applyIdleDecay(merged)
    } catch (err) {
      // A corrupt profile shouldn't block startup; keep the bad file for
      // forensics and continue with a fresh one.
      console.error('Failed to read profile, starting fresh:', err)
      try {
        renameSync(this.path, `${this.path}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
      return defaultProfile()
    }
  }

  private applyIdleDecay(p: Profile): Profile {
    const last = p.attempts.at(-1)?.at
    if (!last) return p
    const days = (Date.now() - new Date(last).getTime()) / 86_400_000
    if (days < 7) return p
    return {
      ...p,
      puzzleRating: decayRd(p.puzzleRating, days),
      playRating: decayRd(p.playRating, days)
    }
  }

  get(): Profile {
    return this.data
  }

  /** Coalesce rapid updates into one write a moment later. */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 400)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleSave()
    return this.data.settings
  }

  setDisplayName(name: string): void {
    this.data.displayName = name.slice(0, 40) || 'Player'
    this.scheduleSave()
  }

  /**
   * Record a puzzle attempt and move the player's overall and per-theme
   * ratings. Hinted solves count as losses for rating purposes — otherwise the
   * number stops meaning anything.
   */
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
    this.scheduleSave()
    return attempt
  }

  /**
   * Attach an engine review to a stored game.
   *
   * Reviews are kept so a game does not have to be re-analysed every time it is
   * opened — a forty-move game costs the better part of a minute of engine
   * time, which is a poor thing to repeat.
   */
  saveGameAnalysis(gameId: string, analysis: GameAnalysis): boolean {
    const game = this.data.games.find((g) => g.id === gameId)
    if (!game) return false
    game.analysis = analysis
    this.scheduleSave()
    return true
  }

  deleteGame(gameId: string): boolean {
    const index = this.data.games.findIndex((g) => g.id === gameId)
    if (index < 0) return false
    this.data.games.splice(index, 1)
    this.scheduleSave()
    return true
  }

  recordGame(game: Omit<GameRecord, 'id' | 'at'>): GameRecord {
    const record: GameRecord = {
      ...game,
      id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString()
    }

    // Only rated outcomes move the play rating. Abandoned games don't count,
    // and neither do games against a human peer, who has no Elo here.
    if (game.result !== '*' && game.opponentElo > 0) {
      const score =
        game.result === '1/2-1/2' ? 0.5 : (game.result === '1-0') === (game.playerColor === 'w') ? 1 : 0
      this.data.playRating = glickoUpdate(this.data.playRating, game.opponentElo, 80, score)

      // Bullet and classical strength are genuinely different skills, so each
      // pace carries its own rating alongside the overall one.
      const pace = game.timeControl?.category ?? 'untimed'
      const current = this.data.paceRatings[pace] ?? newRating(this.data.playRating.rating)
      this.data.paceRatings[pace] = glickoUpdate(current, game.opponentElo, 80, score)
    }

    this.data.games.push(record)
    if (this.data.games.length > MAX_GAMES) {
      this.data.games.splice(0, this.data.games.length - MAX_GAMES)
    }
    this.scheduleSave()
    return record
  }

  /**
   * Record the daily puzzle result and advance the streak.
   *
   * The streak counts consecutive calendar days with a solve; a gap of more
   * than one day resets it. Re-recording the same day is idempotent so a
   * refresh can't inflate the count.
   */
  recordDaily(record: DailyRecord): Profile['streak'] {
    const existing = this.data.daily[record.date]
    this.data.daily[record.date] = record

    if (record.solved && !existing?.solved) {
      const last = this.data.streak.lastDate
      const yesterday = new Date(new Date(record.date + 'T00:00:00').getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10)
      this.data.streak.current = last === yesterday ? this.data.streak.current + 1 : 1
      this.data.streak.longest = Math.max(this.data.streak.longest, this.data.streak.current)
      this.data.streak.lastDate = record.date
    }

    this.scheduleSave()
    return this.data.streak
  }

  /**
   * Update lesson progress using an SM-2 style schedule, so material you get
   * wrong comes back soon and material you know drifts further out.
   */
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
    this.scheduleSave()
    return next
  }

  /** Lessons whose spaced-repetition interval has elapsed. */
  dueLessons(): string[] {
    const now = Date.now()
    return Object.values(this.data.lessons)
      .filter((l) => {
        if (!l.lastSeen) return true
        return now - new Date(l.lastSeen).getTime() >= l.intervalDays * 86_400_000
      })
      .map((l) => l.lessonId)
  }

  export(): string {
    return JSON.stringify(this.data, null, 2)
  }

  import(json: string): Profile {
    const parsed = JSON.parse(json) as Partial<Profile>
    if (typeof parsed !== 'object' || parsed == null) throw new Error('Not a profile file')
    if (!parsed.puzzleRating || !parsed.settings) throw new Error('File is missing profile fields')
    this.data = { ...defaultProfile(), ...parsed, version: PROFILE_VERSION } as Profile
    this.saveNow()
    return this.data
  }

  reset(): Profile {
    this.data = defaultProfile()
    this.saveNow()
    return this.data
  }

  get filePath(): string {
    return this.path
  }
}
