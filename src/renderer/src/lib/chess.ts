import { Chess, type Move, type Square } from 'chess.js'
import type { Color } from '@shared/types'

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export interface PlacedPiece {
  square: Square
  color: Color
  type: PieceType
}

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** All 64 squares, a1 through h8. */
export const ALL_SQUARES: Square[] = RANKS.flatMap((r) => FILES.map((f) => `${f}${r}` as Square))

export function fileIndex(square: Square): number {
  return square.charCodeAt(0) - 97
}

export function rankIndex(square: Square): number {
  return Number(square[1]) - 1
}

export function makeSquare(file: number, rank: number): Square {
  return `${FILES[file]}${RANKS[rank]}` as Square
}

/** Light squares are the ones where file and rank indices share parity. */
export function isLightSquare(square: Square): boolean {
  return (fileIndex(square) + rankIndex(square)) % 2 === 1
}

/**
 * Screen position of a square as a 0-7 column/row pair, accounting for which
 * way the board is facing.
 */
export function squareToXY(square: Square, orientation: Color): { x: number; y: number } {
  const f = fileIndex(square)
  const r = rankIndex(square)
  return orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r }
}

export function xyToSquare(x: number, y: number, orientation: Color): Square | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null
  return orientation === 'w' ? makeSquare(x, 7 - y) : makeSquare(7 - x, y)
}

/** Read a FEN's placement field into a flat list of pieces. */
export function piecesFromFen(fen: string): PlacedPiece[] {
  const placement = fen.split(' ')[0]
  const pieces: PlacedPiece[] = []
  let rank = 7
  let file = 0

  for (const ch of placement) {
    if (ch === '/') {
      rank--
      file = 0
    } else if (ch >= '1' && ch <= '8') {
      file += Number(ch)
    } else {
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b'
      pieces.push({
        square: makeSquare(file, rank),
        color,
        type: ch.toLowerCase() as PieceType
      })
      file++
    }
  }
  return pieces
}

/** Side to move, straight from the FEN. */
export function turnFromFen(fen: string): Color {
  return (fen.split(' ')[1] as Color) ?? 'w'
}

/** Full-move number, used to label moves in the move list. */
export function moveNumberFromFen(fen: string): number {
  return Number(fen.split(' ')[5]) || 1
}

export function createGame(fen: string = START_FEN): Chess {
  return new Chess(fen)
}

/** Squares the piece on `from` may legally move to. */
export function legalDestinations(game: Chess, from: Square): Square[] {
  return game.moves({ square: from, verbose: true }).map((m) => m.to as Square)
}

/** The square of the king in check, if any side is in check. */
export function checkedKingSquare(game: Chess): Square | null {
  if (!game.inCheck()) return null
  const turn = game.turn()
  for (const p of piecesFromFen(game.fen())) {
    if (p.type === 'k' && p.color === turn) return p.square
  }
  return null
}

/** True when moving `from`→`to` would land a pawn on the last rank. */
export function isPromotion(game: Chess, from: Square, to: Square): boolean {
  const piece = game.get(from)
  if (!piece || piece.type !== 'p') return false
  const targetRank = to[1]
  return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')
}

export interface UciMove {
  from: Square
  to: Square
  promotion?: PieceType
}

/** Split a UCI string such as `e7e8q` into its parts. */
export function parseUci(uci: string): UciMove | null {
  if (uci.length < 4) return null
  const from = uci.slice(0, 2) as Square
  const to = uci.slice(2, 4) as Square
  const promotion = uci.length > 4 ? (uci[4].toLowerCase() as PieceType) : undefined
  return { from, to, promotion }
}

export function toUci(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

/**
 * Convert a UCI move to SAN in the context of `fen`, without disturbing the
 * caller's game object.
 */
export function uciToSan(fen: string, uci: string): string | null {
  const parsed = parseUci(uci)
  if (!parsed) return null
  try {
    const game = new Chess(fen)
    const move = game.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion ?? 'q' })
    return move ? move.san : null
  } catch {
    return null
  }
}

/** Replay a UCI line from `fen`, returning the SAN for each move. */
export function uciLineToSan(fen: string, line: string[]): string[] {
  const game = new Chess(fen)
  const san: string[] = []
  for (const uci of line) {
    const parsed = parseUci(uci)
    if (!parsed) break
    try {
      const move = game.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion ?? 'q' })
      if (!move) break
      san.push(move.san)
    } catch {
      break
    }
  }
  return san
}

export interface GameOutcome {
  over: boolean
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  /** Human-readable reason, e.g. 'Checkmate' or 'Threefold repetition'. */
  termination: string
  /** Winner, or null for a draw or an unfinished game. */
  winner: Color | null
}

export function outcomeOf(game: Chess): GameOutcome {
  if (!game.isGameOver()) {
    return { over: false, result: '*', termination: 'In progress', winner: null }
  }
  if (game.isCheckmate()) {
    // The side to move has been mated, so the other side won.
    const winner: Color = game.turn() === 'w' ? 'b' : 'w'
    return {
      over: true,
      result: winner === 'w' ? '1-0' : '0-1',
      termination: 'Checkmate',
      winner
    }
  }
  const termination = game.isStalemate()
    ? 'Stalemate'
    : game.isInsufficientMaterial()
      ? 'Insufficient material'
      : game.isThreefoldRepetition()
        ? 'Threefold repetition'
        : 'Fifty-move rule'
  return { over: true, result: '1/2-1/2', termination, winner: null }
}

/**
 * Total material for one side in pawns, used for the captured-pieces readout.
 * Kings are excluded since both sides always have exactly one.
 */
const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export interface MaterialBalance {
  /** Pieces white has captured, i.e. black pieces missing from the board. */
  whiteCaptured: PieceType[]
  blackCaptured: PieceType[]
  /** Positive when white is ahead, in pawns. */
  advantage: number
}

const FULL_ARMY: PieceType[] = [
  'q',
  'r',
  'r',
  'b',
  'b',
  'n',
  'n',
  'p',
  'p',
  'p',
  'p',
  'p',
  'p',
  'p',
  'p'
]

export function materialBalance(fen: string): MaterialBalance {
  const pieces = piecesFromFen(fen)

  const remaining = (color: Color): PieceType[] =>
    pieces.filter((p) => p.color === color && p.type !== 'k').map((p) => p.type)

  const missing = (color: Color): PieceType[] => {
    const have = [...remaining(color)]
    const gone: PieceType[] = []
    for (const type of FULL_ARMY) {
      const idx = have.indexOf(type)
      if (idx >= 0) have.splice(idx, 1)
      else gone.push(type)
    }
    // Promotions can leave a side with more of a piece than it started with,
    // which would otherwise show up as a phantom capture.
    return gone
  }

  const whiteCaptured = missing('b')
  const blackCaptured = missing('w')

  const score = (list: PieceType[]): number => list.reduce((sum, t) => sum + PIECE_VALUES[t], 0)
  const advantage = score(whiteCaptured) - score(blackCaptured)

  return { whiteCaptured, blackCaptured, advantage }
}

/** Format a centipawn score the way chess software conventionally does. */
export function formatEval(cp: number | null, mate: number | null): string {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`
  if (cp == null) return '0.00'
  const pawns = cp / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`
}

/**
 * Map an evaluation to a 0-1 win probability for the eval bar.
 *
 * The logistic constant is the one Lichess uses; it maps roughly +1.0 pawns to
 * a 60% expected score, which matches how strong players read an advantage.
 */
export function winProbability(cp: number | null, mate: number | null): number {
  if (mate != null) return mate > 0 ? 1 : 0
  if (cp == null) return 0.5
  return 1 / (1 + Math.exp(-0.00368208 * cp))
}

/** Flip a score so it is always from white's point of view. */
export function toWhitePov(cp: number | null, mate: number | null, turn: Color): { cp: number | null; mate: number | null } {
  if (turn === 'w') return { cp, mate }
  return { cp: cp == null ? null : -cp, mate: mate == null ? null : -mate }
}

export type { Square, Move }
