import { describe, expect, it } from 'vitest'

import {
  expectedScore,
  invertWdl,
  pseudoCentipawns,
  rankCandidates,
  sampleCandidate,
  wdlFromLogits
} from './policy'
import type { LegalMove } from './position'

const legal: LegalMove[] = [
  { uci: 'e2e4', index: 0 },
  { uci: 'd2d4', index: 1 },
  { uci: 'a2a3', index: 2 }
]

function logitsOf(values: number[]): Float32Array {
  return Float32Array.from(values)
}

describe('rankCandidates', () => {
  it('sorts by policy and normalises over legal moves only', () => {
    // Index 3 is deliberately the largest; it is not legal, so it must not
    // affect the distribution at all.
    const ranked = rankCandidates(logitsOf([2, 1, 0, 99]), legal)

    expect(ranked.map((candidate) => candidate.uci)).toEqual(['e2e4', 'd2d4', 'a2a3'])
    const total = ranked.reduce((sum, candidate) => sum + candidate.policy, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(ranked[0].policy).toBeGreaterThan(ranked[1].policy)
  })

  it('returns nothing when there are no legal moves', () => {
    expect(rankCandidates(logitsOf([1, 2, 3]), [])).toEqual([])
  })
})

describe('sampleCandidate', () => {
  const ranked = rankCandidates(logitsOf([3, 2, 1, 0]), legal)

  it('plays the top move at temperature 0', () => {
    for (let i = 0; i < 5; i++) {
      expect(sampleCandidate(ranked, { temperature: 0 })?.uci).toBe('e2e4')
    }
  })

  it('can pick a lower-ranked move when sampling', () => {
    // A roll near the top of the range must fall through to a later candidate.
    const picked = sampleCandidate(ranked, { temperature: 1, random: () => 0.999 })
    expect(picked?.uci).not.toBe('e2e4')
  })

  it('restricts the pool under top-p', () => {
    const picked = sampleCandidate(ranked, { temperature: 1, topP: 0.5, random: () => 0.999 })
    // With half the mass, only the leading moves stay in the pool.
    expect(['e2e4', 'd2d4']).toContain(picked?.uci)
  })

  it('returns null for an empty candidate list', () => {
    expect(sampleCandidate([], { temperature: 0 })).toBeNull()
  })
})

describe('value head', () => {
  it('reads logits as [loss, draw, win]', () => {
    // Third entry is the largest, so a win must dominate.
    const wdl = wdlFromLogits(logitsOf([0, 0, 5]))
    expect(wdl.win).toBeGreaterThan(0.9)
    expect(wdl.win + wdl.draw + wdl.loss).toBeCloseTo(1, 10)
  })

  it('reads a batch at an offset', () => {
    const batched = logitsOf([5, 0, 0, 0, 0, 5])
    expect(wdlFromLogits(batched, 0).loss).toBeGreaterThan(0.9)
    expect(wdlFromLogits(batched, 3).win).toBeGreaterThan(0.9)
  })

  it('inverts perspective', () => {
    const wdl = { win: 0.6, draw: 0.3, loss: 0.1 }
    expect(invertWdl(wdl)).toEqual({ win: 0.1, draw: 0.3, loss: 0.6 })
  })

  it('scores a draw at one half', () => {
    expect(expectedScore({ win: 0, draw: 1, loss: 0 })).toBe(0.5)
    expect(expectedScore({ win: 1, draw: 0, loss: 0 })).toBe(1)
    expect(expectedScore({ win: 0.5, draw: 0.5, loss: 0 })).toBe(0.75)
  })

  it('maps an even position to zero on the display scale', () => {
    expect(pseudoCentipawns({ win: 0, draw: 1, loss: 0 })).toBe(0)
    expect(pseudoCentipawns({ win: 0.9, draw: 0.1, loss: 0 })).toBeGreaterThan(0)
    expect(pseudoCentipawns({ win: 0, draw: 0.1, loss: 0.9 })).toBeLessThan(0)
  })
})
