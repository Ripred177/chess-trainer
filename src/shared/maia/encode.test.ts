import { describe, expect, it } from 'vitest'

import fixtures from './__fixtures__/reference.json'
import { FEATURES_PER_SQUARE, HISTORY_PLIES, TOKEN_LENGTH, encodePositions } from './encode'
import { buildPosition } from './position'

/** Flat indices set to 1, which is how the fixtures record the input tensor. */
function activeIndices(tokens: Float32Array): number[] {
  const indices: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 0) indices.push(i)
  }
  return indices
}

describe('tensor shape', () => {
  it('is 64 squares of 8 plies of 12 planes', () => {
    expect(FEATURES_PER_SQUARE).toBe(96)
    expect(TOKEN_LENGTH).toBe(6144)
    expect(fixtures.history).toBe(HISTORY_PLIES)
  })

  it('sets exactly one plane per occupied square per ply', () => {
    const tokens = encodePositions(['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'])
    // 32 pieces, repeated across all eight plies.
    expect(activeIndices(tokens)).toHaveLength(32 * HISTORY_PLIES)
  })
})

describe('encoding against the Python reference', () => {
  for (const testCase of fixtures.cases) {
    it(testCase.name, () => {
      // The fixtures cover both history modes. Without history the reference
      // repeats the current position to fill the window, which is what the app
      // does for a bare FEN; with it, the real line is encoded.
      const fens = testCase.useHistory
        ? buildPosition(testCase.fen, testCase.moves).fens
        : [buildPosition(testCase.fen, testCase.moves).fens.at(-1) as string]

      const tokens = encodePositions(fens)
      expect(activeIndices(tokens)).toEqual(testCase.tokenIndices)
    })
  }
})

describe('history window', () => {
  it('pads a short history by repeating the oldest position', () => {
    const single = encodePositions(['8/8/8/4k3/8/4K3/4P3/8 w - - 0 1'])
    const perPly = activeIndices(single).length / HISTORY_PLIES
    expect(perPly).toBe(3)
  })

  it('keeps only the most recent plies', () => {
    const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'c1g5']
    const position = buildPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves)
    expect(position.fens).toHaveLength(HISTORY_PLIES)

    // Encoding a longer run must equal encoding just its tail.
    const long = encodePositions(position.fens)
    const tail = encodePositions(position.fens.slice(-HISTORY_PLIES))
    expect(Array.from(long)).toEqual(Array.from(tail))
  })
})
