import { Chess } from 'chess.js'
import type { GameAnalysis, MoveJudgement, MoveQuality } from '@shared/types'
import { parseUci, uciToSan, winProbability } from './chess'

/**
 * Engine review of a finished game.
 *
 * Each position is evaluated exactly once. That is enough, because the
 * evaluation *after* a move is simply the evaluation of the next position with
 * the sign flipped — so a game of N moves needs N+1 searches rather than 2N.
 *
 * Moves are judged on the drop in win probability they cause, not on raw
 * centipawns. Giving up 300 centipawns while already completely winning barely
 * changes the outcome, whereas the same loss in a level position is decisive;
 * classifying on centipawns alone marks the first as a blunder and misleads.
 */

/** Mate scores fold into centipawns so one comparison covers both. */
const MATE_CP = 100_000

/**
 * Thresholds on win-probability drop, expressed 0-1.
 *
 * Chosen to sit close to what players are used to from Lichess and chess.com:
 * an inaccuracy is a noticeable slip, a mistake hands over real ground, and a
 * blunder changes who is winning.
 */
const BLUNDER = 0.3
const MISTAKE = 0.15
const INACCURACY = 0.07

export interface ReviewProgress {
  /** Positions examined so far. */
  done: number
  total: number
}

export interface ReviewOptions {
  depth?: number
  onProgress?: (progress: ReviewProgress) => void
  /** Checked between positions so a long review can be abandoned. */
  shouldCancel?: () => boolean
}

interface PositionEval {
  /** Centipawns from the side to move's point of view. */
  cp: number | null
  /** Mate distance from the side to move's point of view. */
  mate: number | null
  /** The engine's preferred move, in UCI. */
  best: string | null
}

/** Collapse an evaluation to plain centipawns for comparison. */
function toCp(evaluation: PositionEval): number {
  if (evaluation.mate != null) {
    return evaluation.mate > 0 ? MATE_CP - evaluation.mate * 100 : -MATE_CP - evaluation.mate * 100
  }
  return evaluation.cp ?? 0
}

function classify(winDrop: number, playedBest: boolean): MoveQuality {
  if (playedBest) return 'best'
  if (winDrop >= BLUNDER) return 'blunder'
  if (winDrop >= MISTAKE) return 'mistake'
  if (winDrop >= INACCURACY) return 'inaccuracy'
  return 'good'
}

const EMPTY_COUNTS: Record<MoveQuality, number> = {
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0
}

/**
 * Review a game from its PGN.
 *
 * Returns null when the PGN cannot be parsed or the review was cancelled.
 */
export async function reviewGame(pgn: string, options: ReviewOptions = {}): Promise<GameAnalysis | null> {
  const depth = options.depth ?? 14

  const game = new Chess()
  try {
    game.loadPgn(pgn)
  } catch {
    return null
  }

  const moves = game.history({ verbose: true })
  if (moves.length === 0) return null

  // Replay from the start, collecting the position before each move.
  const replay = new Chess()
  const positions: string[] = [replay.fen()]
  for (const move of moves) {
    replay.move({ from: move.from, to: move.to, promotion: move.promotion })
    positions.push(replay.fen())
  }

  const total = positions.length
  const evaluations: PositionEval[] = []

  for (let i = 0; i < total; i++) {
    if (options.shouldCancel?.()) return null

    const probe = new Chess(positions[i])
    // A finished position has no move to find; the result is already decided.
    if (probe.isGameOver()) {
      evaluations.push({ cp: probe.isCheckmate() ? -MATE_CP : 0, mate: null, best: null })
    } else {
      const result = await window.chess.engine.evaluate({ fen: positions[i], depth })
      const line = result.info?.lines[0]
      evaluations.push({
        cp: line?.cp ?? null,
        mate: line?.mate ?? null,
        best: result.bestmove
      })
    }

    options.onProgress?.({ done: i + 1, total })
  }

  const judgements: MoveJudgement[] = []

  for (let i = 0; i < moves.length; i++) {
    const before = evaluations[i]
    const after = evaluations[i + 1]

    // `before` is from the mover's view; `after` is from the opponent's, so it
    // is negated to bring both onto the mover's scale.
    const beforeCp = toCp(before)
    const afterCp = -toCp(after)

    const wpBefore = winProbability(
      before.mate != null ? null : beforeCp,
      before.mate != null ? before.mate : null
    )
    const wpAfter = winProbability(
      after.mate != null ? null : afterCp,
      after.mate != null ? -after.mate : null
    )

    const winDrop = Math.max(0, wpBefore - wpAfter)
    const loss = Math.max(0, beforeCp - afterCp)

    const bestUci = before.best
    const playedUci = `${moves[i].from}${moves[i].to}${moves[i].promotion ?? ''}`
    const playedBest = bestUci != null && (bestUci === playedUci || bestUci.slice(0, 4) === playedUci.slice(0, 4))

    // Report the engine's choice in the notation the player reads.
    const bestSan = bestUci ? uciToSan(positions[i], bestUci) : null

    // White's point of view for display, so the numbers read like an eval bar.
    // After a White move it is Black to move, so `after` is on Black's scale
    // and must be negated; after a Black move it is already on White's.
    const whitePov = moves[i].color === 'w' ? -toCp(after) : toCp(after)
    const mateWhitePov =
      after.mate == null ? null : moves[i].color === 'w' ? -after.mate : after.mate

    judgements.push({
      ply: i,
      san: moves[i].san,
      best: bestSan,
      loss: Math.min(loss, 2000),
      winDrop,
      quality: classify(winDrop, playedBest),
      evalAfter: after.mate == null ? whitePov : null,
      mateAfter: mateWhitePov
    })
  }

  const summary = {
    w: { ...EMPTY_COUNTS },
    b: { ...EMPTY_COUNTS },
    averageLoss: { w: 0, b: 0 }
  }
  const totals = { w: 0, b: 0 }
  const counts = { w: 0, b: 0 }

  for (const j of judgements) {
    const side = j.ply % 2 === 0 ? 'w' : 'b'
    summary[side][j.quality]++
    totals[side] += j.loss
    counts[side]++
  }
  summary.averageLoss.w = counts.w ? Math.round(totals.w / counts.w) : 0
  summary.averageLoss.b = counts.b ? Math.round(totals.b / counts.b) : 0

  return { depth, at: new Date().toISOString(), judgements, summary }
}

export const QUALITY_LABEL: Record<MoveQuality, string> = {
  best: 'Best move',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder'
}

export const QUALITY_COLOR: Record<MoveQuality, string> = {
  best: 'var(--color-accent-400)',
  good: 'var(--text-secondary)',
  inaccuracy: 'var(--color-info-400)',
  mistake: 'var(--color-warn-400)',
  blunder: 'var(--color-danger-400)'
}

/** Short marks appended in the move list, as in published annotations. */
export const QUALITY_GLYPH: Record<MoveQuality, string> = {
  best: '',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??'
}

export { parseUci }
