/**
 * Maia-3's move vocabulary, and the mirroring that goes with it.
 *
 * The network always sees the position from the side to move's point of view:
 * when Black is to move the board is flipped vertically and the piece colours
 * are swapped, so the model only ever reasons about "white to move". Its move
 * predictions come back in that flipped frame and have to be mirrored back
 * before they mean anything on the real board.
 *
 * Getting this wrong does not throw - it produces legal moves that make no
 * sense - so everything here is pinned against the Python reference by
 * `vocabulary.test.ts`.
 */

/** Plain from-to moves: every ordered pair of squares. */
export const PLAIN_MOVE_COUNT = 64 * 64

/**
 * Promotions are always rank 7 to rank 8, because the board is flipped for
 * Black. Eight source files x eight target files x four pieces.
 */
export const PROMOTION_COUNT = 8 * 8 * 4

export const VOCABULARY_SIZE = PLAIN_MOVE_COUNT + PROMOTION_COUNT

/** Promotion order within the vocabulary. Fixed by the model's output head. */
export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const

export type PromotionPiece = (typeof PROMOTION_PIECES)[number]

const FILES = 'abcdefgh'

/**
 * Square indices follow the model's convention: a1 = 0, h1 = 7, a8 = 63.
 * That is `rank * 8 + file`, the same order python-chess uses.
 */
export function squareIndex(name: string): number {
  const file = FILES.indexOf(name[0])
  const rank = name.charCodeAt(1) - 49 // '1' -> 0
  if (file < 0 || rank < 0 || rank > 7) throw new Error(`not a square: ${name}`)
  return rank * 8 + file
}

export function squareName(index: number): string {
  return FILES[index & 7] + String((index >> 3) + 1)
}

/** Flip a square vertically. Rank and file share a byte, so this is one xor. */
export function flipSquare(index: number): number {
  return index ^ 56
}

/** Mirror a UCI move vertically, leaving files and any promotion piece alone. */
export function mirrorMove(uci: string): string {
  const flip = (square: string): string => square[0] + String(9 - Number(square[1]))
  return flip(uci.slice(0, 2)) + flip(uci.slice(2, 4)) + uci.slice(4)
}

/**
 * Vocabulary index for a UCI move already expressed in the model's frame.
 *
 * Returns -1 for anything outside the vocabulary, which is how illegal or
 * malformed input is filtered rather than by throwing.
 */
export function moveToIndex(uci: string): number {
  if (uci.length < 4) return -1

  const from = squareIndex(uci.slice(0, 2))
  const to = squareIndex(uci.slice(2, 4))

  if (uci.length === 4) return from * 64 + to

  const piece = PROMOTION_PIECES.indexOf(uci[4] as PromotionPiece)
  if (piece < 0) return -1
  // Promotions only exist from rank 7 to rank 8 in the model's frame.
  if (from >> 3 !== 6 || to >> 3 !== 7) return -1

  const fromFile = from & 7
  const toFile = to & 7
  return PLAIN_MOVE_COUNT + (fromFile * 8 + toFile) * 4 + piece
}

/** Inverse of `moveToIndex`, still in the model's frame. */
export function indexToMove(index: number): string {
  if (index < 0 || index >= VOCABULARY_SIZE) throw new Error(`index out of range: ${index}`)

  if (index < PLAIN_MOVE_COUNT) {
    return squareName(index >> 6) + squareName(index & 63)
  }

  const offset = index - PLAIN_MOVE_COUNT
  const piece = PROMOTION_PIECES[offset % 4]
  const pair = (offset - (offset % 4)) / 4
  const toFile = pair % 8
  const fromFile = (pair - toFile) / 8
  return `${FILES[fromFile]}7${FILES[toFile]}8${piece}`
}

/**
 * Convert a move between the real board and the model's frame.
 *
 * The transform is its own inverse, so one function serves both directions;
 * `turn` is the side to move on the real board.
 */
export function toModelFrame(uci: string, turn: 'w' | 'b'): string {
  return turn === 'w' ? uci : mirrorMove(uci)
}

export const fromModelFrame = toModelFrame
