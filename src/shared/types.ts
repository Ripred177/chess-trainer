/** Types shared between the Electron main process and the renderer. */

export type Color = 'w' | 'b'

// ---------------------------------------------------------------- engine ----

/** A single principal variation reported by the engine at a given depth. */
export interface EngineLine {
  multipv: number
  depth: number
  /** Centipawns from the side-to-move's point of view. Null when `mate` is set. */
  cp: number | null
  /** Moves to mate, signed. Positive = side to move mates. Null when `cp` is set. */
  mate: number | null
  /** Principal variation as UCI move strings, e.g. ['e2e4', 'e7e5']. */
  pv: string[]
}

export interface EngineInfo {
  depth: number
  seldepth?: number
  nodes?: number
  nps?: number
  timeMs?: number
  hashfull?: number
  lines: EngineLine[]
}

export interface EngineResult {
  bestmove: string | null
  ponder: string | null
  info: EngineInfo | null
}

/**
 * How strong the opponent should be. Stockfish's own UCI_Elo only reaches down
 * to 1320, so anything weaker is emulated in `engine.ts` by capping search and
 * deliberately choosing inferior moves.
 */
export interface StrengthSpec {
  /** Target Elo, 250-3190. */
  elo: number
  /** Hard cap on thinking time per move. */
  moveTimeMs: number
}

/** Remaining time on both clocks, in the UCI `go` command's own vocabulary. */
export interface ClockBudget {
  wtime: number
  btime: number
  winc: number
  binc: number
}

export interface GoOptions {
  fen: string
  /** Moves played from `fen`, in UCI form, to preserve repetition history. */
  moves?: string[]
  strength?: StrengthSpec
  depth?: number
  movetime?: number
  nodes?: number
  multipv?: number
  /**
   * When present, the engine manages its own thinking time against these
   * clocks instead of spending a fixed amount per move.
   */
  clock?: ClockBudget
}

// --------------------------------------------------------------- puzzles ----

export interface Puzzle {
  id: string
  /** Position BEFORE the opponent's blunder-punishing first move is played. */
  fen: string
  /** Solution line in UCI. moves[0] is played automatically as the setup move. */
  moves: string[]
  rating: number
  ratingDeviation: number
  popularity: number
  nbPlays: number
  themes: string[]
  gameUrl: string
  openingTags: string[]
}

export interface PuzzleQuery {
  minRating?: number
  maxRating?: number
  themes?: string[]
  /** Require every theme in `themes` rather than any of them. */
  matchAll?: boolean
  opening?: string
  limit?: number
  /** Exclude puzzles already solved by the player. */
  excludeSolved?: boolean
  seed?: number
}

export interface PuzzleStats {
  total: number
  minRating: number
  maxRating: number
  themes: { theme: string; count: number }[]
}

// --------------------------------------------------------------- profile ----

export interface RatingRecord {
  rating: number
  rd: number
  /** Number of attempts contributing to this rating. */
  plays: number
}

export interface PuzzleAttempt {
  puzzleId: string
  /** ISO timestamp. */
  at: string
  solved: boolean
  /** Wall-clock milliseconds spent on the puzzle. */
  ms: number
  /** How many hints the player took before solving. */
  hints: number
  ratingBefore: number
  ratingAfter: number
}

export type TimeCategory = 'untimed' | 'bullet' | 'blitz' | 'rapid' | 'classical'

export interface TimeControl {
  id: string
  /** Display name, e.g. '3+2'. */
  name: string
  category: TimeCategory
  /** Starting time per side. Zero means the game is untimed. */
  initialMs: number
  /** Added to a player's clock after each of their moves. */
  incrementMs: number
}

/** How a single move was judged against the engine's preference. */
export type MoveQuality = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface MoveJudgement {
  /** Half-move index, 0-based. */
  ply: number
  /** The move that was played, in SAN. */
  san: string
  /** The engine's preference in that position, in SAN. Null if unavailable. */
  best: string | null
  /** Centipawns given up versus the engine's move, from the mover's view. */
  loss: number
  /**
   * Drop in win probability caused by the move, 0-1. Classification uses this
   * rather than raw centipawns: throwing away 300cp matters far less when you
   * are already completely winning than when the game is level.
   */
  winDrop: number
  quality: MoveQuality
  /** Evaluation after the move, in centipawns from White's point of view. */
  evalAfter: number | null
  /** Mate distance after the move, from White's point of view, if forced. */
  mateAfter: number | null
}

export interface GameAnalysis {
  /** Search depth each position was examined to. */
  depth: number
  /** ISO timestamp of when the review ran. */
  at: string
  judgements: MoveJudgement[]
  /** Counts per side, for the summary line. */
  summary: {
    w: Record<MoveQuality, number>
    b: Record<MoveQuality, number>
    /** Mean centipawn loss per move, the usual measure of overall accuracy. */
    averageLoss: { w: number; b: number }
  }
}

export interface GameRecord {
  id: string
  at: string
  /** Colour the human played. */
  playerColor: Color
  /** Zero for a human peer, who has no rating in this app. */
  opponentElo: number
  /** Peer's display name, for games played against a person. */
  opponent?: string
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  /** How the game ended, e.g. 'checkmate', 'resignation', 'stalemate'. */
  termination: string
  pgn: string
  moveCount: number
  /** Pace of the game. Absent on games recorded before clocks existed. */
  timeControl?: { name: string; category: TimeCategory; initialMs: number; incrementMs: number }
  /** Time left on each clock when the game ended, for timed games. */
  clockLeft?: { w: number; b: number }
  /** Engine review, present once the game has been analysed. */
  analysis?: GameAnalysis
}

export interface LessonProgress {
  lessonId: string
  /** 0-1. */
  completion: number
  /** ISO timestamp of last practice, used for spaced repetition. */
  lastSeen: string | null
  /** Current spaced-repetition interval in days. */
  intervalDays: number
  /** SM-2 style ease factor. */
  ease: number
  correct: number
  attempts: number
}

export interface DailyRecord {
  /** Local date as YYYY-MM-DD. */
  date: string
  puzzleId: string
  solved: boolean
  ms: number
  hints: number
}

export interface Profile {
  version: number
  createdAt: string
  displayName: string
  puzzleRating: RatingRecord
  /** Overall play rating, across every time control. */
  playRating: RatingRecord
  /** Per-pace play ratings; bullet strength and classical strength differ. */
  paceRatings: Record<TimeCategory, RatingRecord>
  /** Per-theme puzzle ratings, keyed by Lichess theme id. */
  themeRatings: Record<string, RatingRecord>
  attempts: PuzzleAttempt[]
  games: GameRecord[]
  lessons: Record<string, LessonProgress>
  daily: Record<string, DailyRecord>
  streak: { current: number; longest: number; lastDate: string | null }
  /** Structured study: Woodpecker sets, endgame and opening progress. */
  training: TrainingState
  settings: Settings
}

// -------------------------------------------------------------- training ----

/**
 * The Woodpecker Method (Smith & Tikkanen): solve one fixed set of tactics,
 * then solve the same set again and again, each cycle faster than the last.
 * Nothing new is ever added — the point is to meet the old positions until
 * recognition replaces calculation.
 */
export interface WoodpeckerCycle {
  /** 1-based. */
  index: number
  startedAt: string
  finishedAt: string | null
  /** Time spent solving, excluding pauses between sessions. */
  ms: number
  solved: number
  failed: number
}

export interface WoodpeckerSet {
  id: string
  createdAt: string
  label: string
  /** Fixed puzzle ids, in a fixed order. Never changes once created. */
  puzzleIds: string[]
  minRating: number
  maxRating: number
  themes: string[]
  /** Completed cycles, plus the one in progress as the last entry. */
  cycles: WoodpeckerCycle[]
  /** Index into puzzleIds for the cycle in progress. */
  cursor: number
  /** Ids failed in the current cycle, surfaced for review at the end. */
  missed: string[]
  completedAt: string | null
}

/** Per-position progress in the endgame library. */
export interface EndgameProgress {
  positionId: string
  attempts: number
  successes: number
  lastResult: 'win' | 'draw' | 'loss' | null
  lastSeen: string | null
}

export interface TrainingState {
  /** At most one Woodpecker set runs at a time; finished ones are archived. */
  woodpecker: WoodpeckerSet | null
  woodpeckerArchive: WoodpeckerSet[]
  endgames: Record<string, EndgameProgress>
  /** Openings the player has chosen to drill, as Lichess tag ids. */
  openings: string[]
}

/** One opening, as indexed from the puzzle database's tags. */
export interface OpeningSummary {
  /** Lichess tag, e.g. "Sicilian_Defense_Najdorf_Variation". */
  id: string
  /** Human form, e.g. "Sicilian Defense: Najdorf Variation". */
  name: string
  family: string
  isFamily: boolean
  count: number
}

// -------------------------------------------------------------- settings ----

export interface BoardColors {
  light: string
  dark: string
  /** Highlight for the last move played. */
  lastMove: string
  /** Highlight for the currently selected square. */
  selected: string
  /** Dots/rings marking legal destinations. */
  legal: string
  /** Square of a king in check. */
  check: string
  /** Coordinate label colour on light squares. */
  coordLight: string
  coordDark: string
}

/** Endpoints of the recolour ramp for one side's pieces. */
export interface SideColors {
  /** The body of the piece. */
  piece: string
  /** Outlines, and interior highlights on dark sets. */
  outline: string
}

export interface PieceColors {
  enabled: boolean
  white: SideColors
  black: SideColors
  /** Recolour saturated accents too, instead of preserving them. */
  tintAccents: boolean
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  boardThemeId: string
  /** Overrides applied on top of the selected board theme. */
  boardColorOverrides: Partial<BoardColors>
  pieceSetId: string
  /** Optional recolouring applied on top of the chosen piece set. */
  pieceColors: PieceColors
  boardSize: number
  showCoordinates: boolean
  showLegalMoves: boolean
  highlightLastMove: boolean
  animationMs: number
  soundEnabled: boolean
  soundVolume: number
  autoPromoteToQueen: boolean
  /** Drag pieces, click squares, or both. */
  moveInput: 'both' | 'drag' | 'click'
  showEvalBar: boolean
  engineThreads: number
  engineHashMb: number
  confirmResign: boolean
  /** Id of the time control to preselect on the Play screen. */
  timeControlId: string
  /** Warn with sound and colour when a clock drops below this many seconds. */
  lowTimeWarningSec: number
}

// -------------------------------------------------------------- netplay ----

export type NetRole = 'idle' | 'host' | 'guest'

/** A game announcing itself on the local network. */
export interface DiscoveredHost {
  /** Stable per-game id, so a host that changes address is not duplicated. */
  id: string
  name: string
  address: string
  port: number
  timeControl: TimeControl
}

export interface NetStatus {
  role: NetRole
  state: 'offline' | 'listening' | 'connecting' | 'connected'
  /** Addresses this machine is reachable on, when hosting. */
  addresses?: string[]
  port?: number
  peerAddress?: string
  /** Round-trip time to the peer, from the heartbeat. */
  latencyMs?: number
  /** Last failure, for display. */
  error?: string
}

/**
 * Wire protocol between two peers.
 *
 * Deliberately small and explicit: the host is authoritative for colour, time
 * control, and the clock, so the guest never has to reconcile a disagreement.
 */
export type NetMessage =
  | { t: 'hello'; version: number; name: string }
  | {
      t: 'welcome'
      version: number
      name: string
      /** The colour the *recipient* plays. */
      yourColor: Color
      timeControl: TimeControl
    }
  | {
      t: 'move'
      /** Move in UCI form. */
      uci: string
      /** Half-move number this applies to, so a duplicate can be ignored. */
      ply: number
      /** Host-authoritative clock after the move. */
      clock?: { w: number; b: number }
    }
  | { t: 'resign' }
  | { t: 'drawOffer' }
  | { t: 'drawAccept' }
  | { t: 'drawDecline' }
  | { t: 'rematch' }
  | { t: 'rematchAccept'; yourColor: Color }
  | { t: 'gameOver'; result: '1-0' | '0-1' | '1/2-1/2'; termination: string }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
