/**
 * Board encoding for Maia-3.
 *
 * The network reads a `(64, 96)` tensor: for each square, twelve one-hot piece
 * planes for each of eight plies of history, oldest first. Nothing else is
 * encoded - no castling rights, no en passant square, no clocks - so the model
 * infers those from the history it is given.
 *
 * Every ply is oriented by *its own* side to move, so consecutive plies in a
 * real game alternate orientation. That looks like a bug and is not: it is what
 * the reference implementation does, and therefore what the weights expect.
 */

export const HISTORY_PLIES = 8

/** Six piece types per colour. */
export const PLANES_PER_PLY = 12

export const FEATURES_PER_SQUARE = HISTORY_PLIES * PLANES_PER_PLY

export const TOKEN_LENGTH = 64 * FEATURES_PER_SQUARE

/** Plane offsets, in the order the reference assigns them. */
const PIECE_PLANE: Record<string, number> = {
  p: 0,
  n: 1,
  b: 2,
  r: 3,
  q: 4,
  k: 5
}

/**
 * Write one position's twelve planes into `out` at ply slot `ply`.
 *
 * Only the board placement and side-to-move fields of the FEN are read.
 */
export function encodePly(fen: string, out: Float32Array, ply: number): void {
  const space = fen.indexOf(' ')
  const placement = space === -1 ? fen : fen.slice(0, space)
  const blackToMove = fen[space + 1] === 'b'

  const base = ply * PLANES_PER_PLY

  let rank = 7
  let file = 0

  for (let i = 0; i < placement.length; i++) {
    const char = placement[i]

    if (char === '/') {
      rank--
      file = 0
      continue
    }

    if (char >= '1' && char <= '8') {
      file += char.charCodeAt(0) - 48
      continue
    }

    const lower = char.toLowerCase()
    const plane = PIECE_PLANE[lower]
    if (plane === undefined) throw new Error(`unexpected character in FEN: ${char}`)

    const isWhite = char !== lower
    let square = rank * 8 + file

    // Flip the board and swap colours when Black is to move, so the model only
    // ever sees a position with White on the move.
    let white = isWhite
    if (blackToMove) {
      square ^= 56
      white = !white
    }

    out[square * FEATURES_PER_SQUARE + base + plane + (white ? 0 : 6)] = 1
    file++
  }
}

/**
 * Build the input tensor from a sequence of positions, oldest first.
 *
 * Only the last `HISTORY_PLIES` are used. A shorter sequence is padded at the
 * front by repeating its oldest entry, which is what makes the model usable on
 * the first move of a game or on a bare FEN with no history at all.
 */
export function encodePositions(fens: string[]): Float32Array {
  if (fens.length === 0) throw new Error('at least one position is required')

  const kept = fens.length > HISTORY_PLIES ? fens.slice(-HISTORY_PLIES) : fens
  const padding = HISTORY_PLIES - kept.length

  const tokens = new Float32Array(TOKEN_LENGTH)

  for (let ply = 0; ply < padding; ply++) {
    encodePly(kept[0], tokens, ply)
  }
  for (let i = 0; i < kept.length; i++) {
    encodePly(kept[i], tokens, padding + i)
  }

  return tokens
}

/** Concatenate several positions' tensors into one batched input. */
export function batchTokens(inputs: Float32Array[]): Float32Array {
  const batch = new Float32Array(inputs.length * TOKEN_LENGTH)
  for (let i = 0; i < inputs.length; i++) {
    batch.set(inputs[i], i * TOKEN_LENGTH)
  }
  return batch
}
