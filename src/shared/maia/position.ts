/**
 * Turning an app position into what the model needs: a run of FENs for the
 * history window, and the legal moves paired with their vocabulary indices.
 */

import { Chess } from 'chess.js'
import { HISTORY_PLIES } from './encode'
import { moveToIndex, toModelFrame } from './vocabulary'

export interface LegalMove {
  /** UCI on the real board, e.g. `e7e8q`. */
  uci: string
  /** Index into the model's move vocabulary, in its own mirrored frame. */
  index: number
}

export interface MaiaPosition {
  /** History window, oldest first; the current position is last. */
  fens: string[]
  turn: 'w' | 'b'
  legal: LegalMove[]
  /** True once the side to move has no legal reply. */
  terminal: boolean
  /** Distinguishes a lost game from a drawn one when `terminal`. */
  checkmate: boolean
}

/** Split a UCI string into the shape chess.js wants. */
function parseUci(uci: string): { from: string; to: string; promotion?: string } {
  const move: { from: string; to: string; promotion?: string } = {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4)
  }
  if (uci.length > 4) move.promotion = uci[4]
  return move
}

/** Legal moves of the current position, tagged with their vocabulary indices. */
function legalMoves(chess: Chess): LegalMove[] {
  const turn = chess.turn()
  const legal: LegalMove[] = []

  for (const move of chess.moves({ verbose: true })) {
    const uci = move.from + move.to + (move.promotion ?? '')
    const index = moveToIndex(toModelFrame(uci, turn))
    // Anything outside the vocabulary simply cannot be chosen. In a legal chess
    // position this never happens, but dropping it is safer than throwing from
    // inside a move loop.
    if (index >= 0) legal.push({ uci, index })
  }

  return legal
}

function describe(chess: Chess, fens: string[]): MaiaPosition {
  const legal = legalMoves(chess)
  return {
    fens,
    turn: chess.turn(),
    legal,
    terminal: legal.length === 0,
    checkmate: chess.isCheckmate()
  }
}

/**
 * Build the model's view of a position.
 *
 * `moves` is the line played from `fen`, which is exactly what `GoOptions`
 * already carries for repetition detection. Passing it gives the model real
 * history; without it the current position is repeated to fill the window,
 * which is what the reference engine does for a bare FEN.
 *
 * Only the last `HISTORY_PLIES` positions are ever needed, so a long game costs
 * no more to encode than a short one.
 */
export function buildPosition(fen: string, moves: readonly string[] = []): MaiaPosition {
  const chess = new Chess(fen)
  const fens: string[] = [chess.fen()]

  for (const move of moves) {
    chess.move(parseUci(move))
    fens.push(chess.fen())
    if (fens.length > HISTORY_PLIES) fens.shift()
  }

  return describe(chess, fens)
}

/** The position reached by playing `uci`, for scoring a candidate move. */
export function advance(position: MaiaPosition, uci: string): MaiaPosition {
  const chess = new Chess(position.fens[position.fens.length - 1])
  chess.move(parseUci(uci))

  const fens = [...position.fens, chess.fen()]
  while (fens.length > HISTORY_PLIES) fens.shift()

  return describe(chess, fens)
}
