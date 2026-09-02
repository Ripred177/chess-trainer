/**
 * Turning raw network output into moves and evaluations.
 *
 * Maia-3 has no search and no centipawn evaluation. It gives a probability
 * distribution over moves - how likely a human of the requested rating is to
 * play each one - and a win/draw/loss head. Everything the app shows is derived
 * from those two things.
 */

import type { LegalMove } from './position'

/** Win/draw/loss probabilities from the side to move's point of view. */
export interface Wdl {
  win: number
  draw: number
  loss: number
}

export interface Candidate {
  uci: string
  /** Probability the model assigns among legal moves. Sums to 1 across the list. */
  policy: number
  /** Filled in only when the caller asks for candidate evaluations. */
  wdl?: Wdl
}

/**
 * Rank the legal moves by policy, most likely first.
 *
 * The softmax is taken over legal moves only, which is what makes the
 * probabilities comparable to the reference engine's `MultiPV` output.
 */
export function rankCandidates(logits: Float32Array, legal: readonly LegalMove[]): Candidate[] {
  if (legal.length === 0) return []

  let max = -Infinity
  for (const move of legal) {
    const value = logits[move.index]
    if (value > max) max = value
  }

  const weights = new Float64Array(legal.length)
  let total = 0
  for (let i = 0; i < legal.length; i++) {
    const weight = Math.exp(logits[legal[i].index] - max)
    weights[i] = weight
    total += weight
  }

  const candidates: Candidate[] = []
  for (let i = 0; i < legal.length; i++) {
    candidates.push({ uci: legal[i].uci, policy: weights[i] / total })
  }

  candidates.sort((a, b) => b.policy - a.policy)
  return candidates
}

export interface SampleOptions {
  /**
   * 0 plays the most likely move every time. 1 samples straight from the
   * model's own distribution, which is what makes it feel human.
   */
  temperature?: number
  /** Nucleus sampling: consider only the most likely moves totalling `topP`. */
  topP?: number
  /** Injectable for deterministic tests. */
  random?: () => number
}

/**
 * Choose a move from ranked candidates.
 *
 * Sampling is what gives Maia its variety; at temperature 0 the same position
 * always draws the same reply, which is fine for analysis but makes for a
 * predictable opponent.
 */
export function sampleCandidate(
  candidates: readonly Candidate[],
  options: SampleOptions = {}
): Candidate | null {
  if (candidates.length === 0) return null

  const temperature = options.temperature ?? 1
  const topP = options.topP ?? 1
  const random = options.random ?? Math.random

  if (temperature <= 0) return candidates[0]

  // Re-weight by temperature. Candidates arrive already normalised, so working
  // in log space keeps this stable for very small probabilities.
  const weights = candidates.map((candidate) =>
    candidate.policy <= 0 ? 0 : Math.exp(Math.log(candidate.policy) / temperature)
  )

  let total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return candidates[0]

  let pool = candidates.length
  if (topP < 1) {
    // Candidates are sorted, so the nucleus is a prefix. Always keep the first.
    let cumulative = 0
    pool = 0
    for (let i = 0; i < candidates.length; i++) {
      cumulative += weights[i] / total
      pool = i + 1
      if (cumulative >= topP) break
    }
    total = 0
    for (let i = 0; i < pool; i++) total += weights[i]
  }

  let roll = random() * total
  for (let i = 0; i < pool; i++) {
    roll -= weights[i]
    if (roll <= 0) return candidates[i]
  }
  return candidates[pool - 1]
}

/**
 * Read the value head.
 *
 * The network emits logits ordered [loss, draw, win]; everything above the
 * model layer speaks win-first, so they are reordered here once.
 */
export function wdlFromLogits(logits: Float32Array, offset = 0): Wdl {
  const loss = logits[offset]
  const draw = logits[offset + 1]
  const win = logits[offset + 2]

  const max = Math.max(loss, draw, win)
  const expLoss = Math.exp(loss - max)
  const expDraw = Math.exp(draw - max)
  const expWin = Math.exp(win - max)
  const total = expLoss + expDraw + expWin

  return { win: expWin / total, draw: expDraw / total, loss: expLoss / total }
}

/** Swap perspective, for reading an opponent's evaluation as our own. */
export function invertWdl(wdl: Wdl): Wdl {
  return { win: wdl.loss, draw: wdl.draw, loss: wdl.win }
}

/**
 * Expected score, 0 to 1 - the natural currency for an eval bar backed by a
 * WDL head, and what the app uses in place of centipawns.
 */
export function expectedScore(wdl: Wdl): number {
  return wdl.win + wdl.draw / 2
}

/**
 * A centipawn-flavoured number for display only.
 *
 * There is no search behind this and it is not comparable to a Stockfish
 * evaluation; it exists so the existing eval readouts have something with a
 * familiar shape to render. The mapping is the standard logistic used to turn
 * win probability back into pawns.
 */
export function pseudoCentipawns(wdl: Wdl): number {
  const score = Math.min(0.999, Math.max(0.001, expectedScore(wdl)))
  // Adding zero collapses -0, which would otherwise render as "-0" in the UI.
  return Math.round((-Math.log(1 / score - 1) * 100) / 0.368) + 0
}
