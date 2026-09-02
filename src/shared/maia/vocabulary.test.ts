import { describe, expect, it } from 'vitest'

import fixtures from './__fixtures__/reference.json'
import { buildPosition } from './position'
import {
  PLAIN_MOVE_COUNT,
  VOCABULARY_SIZE,
  flipSquare,
  indexToMove,
  mirrorMove,
  moveToIndex,
  squareIndex,
  squareName
} from './vocabulary'

describe('square indexing', () => {
  it('matches the model convention of a1 = 0, h8 = 63', () => {
    expect(squareIndex('a1')).toBe(0)
    expect(squareIndex('h1')).toBe(7)
    expect(squareIndex('a2')).toBe(8)
    expect(squareIndex('e4')).toBe(28)
    expect(squareIndex('h8')).toBe(63)
  })

  it('round-trips every square', () => {
    for (let i = 0; i < 64; i++) {
      expect(squareIndex(squareName(i))).toBe(i)
    }
  })

  it('flips rank but not file', () => {
    expect(squareName(flipSquare(squareIndex('a1')))).toBe('a8')
    expect(squareName(flipSquare(squareIndex('e2')))).toBe('e7')
    // Flipping twice is the identity, which is what lets one function serve
    // both directions of the model-frame conversion.
    for (let i = 0; i < 64; i++) {
      expect(flipSquare(flipSquare(i))).toBe(i)
    }
  })
})

describe('move mirroring', () => {
  it('mirrors ranks and keeps the promotion piece', () => {
    expect(mirrorMove('e2e4')).toBe('e7e5')
    expect(mirrorMove('a7a8q')).toBe('a2a1q')
    expect(mirrorMove('e1g1')).toBe('e8g8')
  })

  it('is its own inverse', () => {
    for (const uci of ['e2e4', 'g1f3', 'a7a8n', 'h2h1r', 'e8c8']) {
      expect(mirrorMove(mirrorMove(uci))).toBe(uci)
    }
  })
})

describe('vocabulary', () => {
  it('is the size the model was exported with', () => {
    expect(VOCABULARY_SIZE).toBe(fixtures.vocabularySize)
    expect(VOCABULARY_SIZE).toBe(4352)
  })

  it('round-trips every index', () => {
    for (let index = 0; index < VOCABULARY_SIZE; index++) {
      expect(moveToIndex(indexToMove(index))).toBe(index)
    }
  })

  it('orders plain moves as from * 64 + to', () => {
    expect(moveToIndex('a1a1')).toBe(0)
    expect(moveToIndex('a1h8')).toBe(63)
    expect(moveToIndex('e2e4')).toBe(squareIndex('e2') * 64 + squareIndex('e4'))
  })

  it('orders promotions as q, r, b, n after the plain moves', () => {
    expect(moveToIndex('a7a8q')).toBe(PLAIN_MOVE_COUNT)
    expect(moveToIndex('a7a8r')).toBe(PLAIN_MOVE_COUNT + 1)
    expect(moveToIndex('a7a8b')).toBe(PLAIN_MOVE_COUNT + 2)
    expect(moveToIndex('a7a8n')).toBe(PLAIN_MOVE_COUNT + 3)
    // Second entry is the same source file promoting onto the next file.
    expect(moveToIndex('a7b8q')).toBe(PLAIN_MOVE_COUNT + 4)
  })

  it('rejects promotions outside rank 7 to rank 8', () => {
    // The board is always flipped so the mover promotes upward, so a promotion
    // anywhere else means the caller forgot to convert to the model frame.
    expect(moveToIndex('a2a1q')).toBe(-1)
    expect(moveToIndex('a7a8k')).toBe(-1)
  })
})

describe('legal move indices against the Python reference', () => {
  // The reference records, for each position, exactly which vocabulary entries
  // it considers legal. Matching that set proves the mirroring, the promotion
  // encoding and the index arithmetic all agree with the model's own view.
  for (const testCase of fixtures.cases) {
    it(testCase.name, () => {
      const position = buildPosition(testCase.fen, testCase.moves)
      const indices = position.legal.map((move) => move.index).sort((a, b) => a - b)
      expect(indices).toEqual(testCase.legalIndices)
    })
  }
})
