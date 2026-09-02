/**
 * The platform-agnostic half of the engine.
 *
 * Desktop and web differ only in how they get tensors through onnxruntime, so
 * that is the single thing they have to supply. Everything about how Maia is
 * driven - encoding, ranking, sampling, evaluating candidates - lives here so
 * the two builds cannot drift apart in how the bots actually play.
 */

import { batchTokens, encodePositions, TOKEN_LENGTH } from './encode'
import {
  expectedScore,
  invertWdl,
  rankCandidates,
  sampleCandidate,
  wdlFromLogits,
  type Candidate,
  type SampleOptions,
  type Wdl
} from './policy'
import { advance, type MaiaPosition } from './position'
import { VOCABULARY_SIZE } from './vocabulary'

/** One batched forward pass. Implemented per platform over onnxruntime. */
export interface MaiaBackend {
  run(input: MaiaInput): Promise<MaiaOutput>
}

export interface MaiaInput {
  batch: number
  /** `batch * TOKEN_LENGTH` board features. */
  tokens: Float32Array
  /** Rating of the side to move, per batch entry. */
  selfElo: Float32Array
  /** Rating of their opponent, per batch entry. */
  oppoElo: Float32Array
}

export interface MaiaOutput {
  /** `batch * VOCABULARY_SIZE` move logits. */
  move: Float32Array
  /** `batch * 3` value logits, ordered [loss, draw, win]. */
  value: Float32Array
}

/** Maia-3 was trained on players from 600 to 2600; outside that it extrapolates. */
export const MAIA_MIN_ELO = 600
export const MAIA_MAX_ELO = 2600

export interface EvaluateOptions extends SampleOptions {
  /** Rating to imitate. Clamped to the model's trained range. */
  elo: number
  /** Rating of the opponent, if it differs. Humans play differently by opponent. */
  oppoElo?: number
  /**
   * How many of the top moves to score with the value head. Each one costs a
   * forward pass, so this is the main cost dial. 0 skips candidate evaluation
   * and returns policy only.
   */
  evaluateTop?: number
}

export interface Evaluation {
  /** The move to play, sampled per `temperature`/`topP`. */
  bestmove: string | null
  /** Legal moves ranked by policy, most likely first. */
  candidates: Candidate[]
  /** Value head for the position as it stands. */
  wdl: Wdl
  /** Expected score for the side to move, 0-1. */
  score: number
}

function clampElo(elo: number): number {
  return Math.min(MAIA_MAX_ELO, Math.max(MAIA_MIN_ELO, Math.round(elo)))
}

/** Drives a Maia backend. Stateless: safe to share across concurrent searches. */
export class MaiaSession {
  constructor(private backend: MaiaBackend) {}

  async evaluate(position: MaiaPosition, options: EvaluateOptions): Promise<Evaluation> {
    const selfElo = clampElo(options.elo)
    const oppoElo = clampElo(options.oppoElo ?? options.elo)

    if (position.terminal) {
      // No legal reply: the game is already over, so there is nothing to ask
      // the network and nothing it could usefully say.
      const wdl: Wdl = position.checkmate
        ? { win: 0, draw: 0, loss: 1 }
        : { win: 0, draw: 1, loss: 0 }
      return { bestmove: null, candidates: [], wdl, score: expectedScore(wdl) }
    }

    const output = await this.backend.run({
      batch: 1,
      tokens: encodePositions(position.fens),
      selfElo: Float32Array.of(selfElo),
      oppoElo: Float32Array.of(oppoElo)
    })

    const candidates = rankCandidates(output.move, position.legal)
    const wdl = wdlFromLogits(output.value)

    const evaluateTop = options.evaluateTop ?? 0
    if (evaluateTop > 0) {
      await this.scoreCandidates(position, candidates.slice(0, evaluateTop), selfElo, oppoElo)
    }

    const picked = sampleCandidate(candidates, options)

    return {
      bestmove: picked?.uci ?? null,
      candidates,
      wdl,
      score: expectedScore(wdl)
    }
  }

  /**
   * Attach a win/draw/loss estimate to each candidate.
   *
   * The value head only ever speaks for the side to move, so each candidate is
   * scored from the *resulting* position - with the two ratings swapped, since
   * it is then the opponent's turn - and the answer inverted back into our
   * point of view. One batched pass covers every candidate at once.
   */
  private async scoreCandidates(
    position: MaiaPosition,
    candidates: Candidate[],
    selfElo: number,
    oppoElo: number
  ): Promise<void> {
    const pending: { candidate: Candidate; tokens: Float32Array }[] = []

    for (const candidate of candidates) {
      const next = advance(position, candidate.uci)

      if (next.terminal) {
        // Mate delivered is a certain win for us; stalemate a certain draw.
        // Asking the network about a finished position would return noise, and
        // a bot that cannot see mate-in-one is not worth shipping.
        candidate.wdl = next.checkmate
          ? { win: 1, draw: 0, loss: 0 }
          : { win: 0, draw: 1, loss: 0 }
        continue
      }

      pending.push({ candidate, tokens: encodePositions(next.fens) })
    }

    if (pending.length === 0) return

    const batch = pending.length
    const output = await this.backend.run({
      batch,
      tokens: batchTokens(pending.map((entry) => entry.tokens)),
      // Swapped: the resulting position is the opponent's to move.
      selfElo: Float32Array.from({ length: batch }, () => oppoElo),
      oppoElo: Float32Array.from({ length: batch }, () => selfElo)
    })

    for (let i = 0; i < batch; i++) {
      pending[i].candidate.wdl = invertWdl(wdlFromLogits(output.value, i * 3))
    }
  }
}

export { TOKEN_LENGTH, VOCABULARY_SIZE }
