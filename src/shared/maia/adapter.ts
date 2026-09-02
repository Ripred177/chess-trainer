/**
 * The bridge between the app's engine contract and Maia.
 *
 * Both builds drive the model identically - the only thing that differs is how
 * onnxruntime is loaded - so all of the behaviour lives here. Anything that
 * decides *how the bots play* belongs in this file, or the desktop and web
 * ladders will quietly diverge.
 */

import type { EngineInfo, EngineLine, EngineResult, GoOptions, StrengthSpec } from '../types'
import { pseudoCentipawns } from './policy'
import { buildPosition, type MaiaPosition } from './position'
import { MAIA_MAX_ELO, MAIA_MIN_ELO, type Evaluation, type MaiaSession } from './session'

/** How many candidates to score with the value head when none is requested. */
export const DEFAULT_EVALUATE_TOP = 5

/** Clamp a requested rating into the range Maia was actually trained on. */
export function clampElo(elo: number): number {
  return Math.min(MAIA_MAX_ELO, Math.max(MAIA_MIN_ELO, Math.round(elo)))
}

export function strengthElo(strength: StrengthSpec | undefined): number {
  return strength ? clampElo(strength.elo) : MAIA_MAX_ELO
}

/**
 * Sampling temperature by rating.
 *
 * The model's distribution already encodes how a player of that rating behaves,
 * so 1 is the honest default and is what makes the bots feel human. The top of
 * the ladder is sharpened: a 2600 that plays its third choice a few times a
 * game is not really a 2600.
 */
export function temperatureFor(elo: number): number {
  if (elo >= MAIA_MAX_ELO) return 0.6
  if (elo <= 1200) return 1
  const t = (elo - 1200) / (MAIA_MAX_ELO - 1200)
  return 1 - t * 0.4
}

/**
 * Convert an evaluation into the renderer's line format.
 *
 * Depth is reported as 1 because that is the truth: there is exactly one
 * forward pass behind every number here, and no tree.
 */
export function toEngineInfo(evaluation: Evaluation, limit: number): EngineInfo {
  const lines: EngineLine[] = evaluation.candidates.slice(0, limit).map((candidate, index) => ({
    multipv: index + 1,
    depth: 1,
    cp: candidate.wdl ? pseudoCentipawns(candidate.wdl) : null,
    // Maia has no notion of a forced mate. A mate that ends the game is handled
    // by the terminal check in the session instead.
    mate: null,
    pv: [candidate.uci],
    policy: candidate.policy,
    wdl: candidate.wdl
  }))

  return { depth: 1, lines, nodes: evaluation.candidates.length }
}

export interface PreparedSearch {
  position: MaiaPosition
  elo: number
  temperature: number
  evaluateTop: number
  /** How many lines the caller asked to see. */
  reportLines: number
}

/**
 * Work out what to ask the model for.
 *
 * Playing needs one sampled move and no candidate scoring; analysis wants the
 * ranked list with a win/draw/loss estimate on each entry, which costs one
 * extra forward pass per candidate.
 */
export function prepareSearch(options: GoOptions): PreparedSearch {
  const position = buildPosition(options.fen, options.moves ?? [])
  const elo = strengthElo(options.strength)
  const multipv = Math.max(1, options.multipv ?? 1)

  // Exactly the lines the caller will show. Each one costs a forward pass, and
  // game review asks for a single line across a hundred positions, so
  // evaluating extras it never displays is the difference between a review
  // taking two seconds and taking seven.
  const evaluateTop = options.strength ? 0 : Math.min(multipv, position.legal.length)

  return {
    position,
    elo,
    temperature: options.strength ? temperatureFor(elo) : 0,
    evaluateTop,
    reportLines: Math.max(multipv, evaluateTop)
  }
}

/** Run one search end to end. Shared by both platforms. */
export async function runSearch(
  session: MaiaSession,
  options: GoOptions
): Promise<{ result: EngineResult; info: EngineInfo | null }> {
  const prepared = prepareSearch(options)

  if (prepared.position.terminal) {
    return { result: { bestmove: null, ponder: null, info: null }, info: null }
  }

  const evaluation: Evaluation = await session.evaluate(prepared.position, {
    elo: prepared.elo,
    temperature: prepared.temperature,
    evaluateTop: prepared.evaluateTop
  })

  const info = toEngineInfo(evaluation, prepared.reportLines)
  return {
    result: { bestmove: evaluation.bestmove, ponder: null, info },
    info
  }
}
