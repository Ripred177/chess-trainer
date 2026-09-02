import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Color, Puzzle } from '@shared/types'
import Board from './Board'
import { useBoardColors, useBoardSize, useSettings } from '../state/useStore'
import { play, playMoveSound } from '../lib/sound'
import { parseUci, uciToSan, type PieceType, type Square } from '../lib/chess'

export type SolveState = 'loading' | 'setup' | 'waiting' | 'wrong' | 'solved' | 'failed'

export interface PuzzleResult {
  puzzleId: string
  solved: boolean
  ms: number
  hints: number
  /**
   * True when this is a repeat run of a puzzle already finished once.
   *
   * Replays are for practice: the first attempt is what counts, so callers
   * should show the outcome but not rate it or count it again.
   */
  replay: boolean
}

export interface PuzzleSolverProps {
  puzzle: Puzzle
  /** Fires once, when the puzzle is finished one way or the other. */
  onComplete: (result: PuzzleResult) => void
  /** External hint trigger, incremented by the parent's hint button. */
  hintRequest?: number
  /** Reveal the whole solution, e.g. after giving up. */
  revealRequest?: number
  /** Step back one move pair, incremented by the parent's rewind button. */
  rewindRequest?: number
  /**
   * Return to the puzzle's opening position.
   *
   * Mid-attempt this only rewinds the board, keeping the mistakes already made.
   * Once the puzzle is over it starts a genuinely fresh attempt instead, since
   * the result is already banked and what the player wants is another go.
   */
  restartRequest?: number
  /**
   * Progress within the attempt, so the parent can show "try again" without
   * ending the puzzle. Fires on every mistake and when the line is completed.
   */
  onProgress?: (progress: { mistakes: number; solved: boolean; canRewind: boolean }) => void
  size?: number
}

/**
 * How long the opponent "thinks" before replying.
 *
 * The pause matters: without it the reply lands in the same frame as your move
 * and it becomes impossible to see what actually happened.
 */
const REPLY_DELAY_MS = 420
const SETUP_DELAY_MS = 550

/** How long a mistake stays on the board before it is taken back. */
const WRONG_HOLD_MS = 1100

/**
 * Hint level at which the board starts revealing squares. The level below it
 * names the tactical motif, which teaches more than a highlight does.
 *
 * The puzzle's *goal* is no longer a hint at all — it is stated up front, the
 * way a puzzle book says "mate in two" above the diagram. Knowing what you are
 * looking for is part of the exercise; knowing where to look is the answer.
 */
export const SQUARE_HINT_LEVEL = 2

/** Total hint levels: motif, piece to move, destination. */
export const MAX_HINT_LEVEL = 3

/**
 * Plays a single Lichess puzzle.
 *
 * The dump's convention is that `fen` is the position *before* the losing move,
 * and `moves[0]` is that move. So the component plays move zero itself, and the
 * player takes over from move one — which is why the puzzle always opens with
 * the opponent making a mistake in front of you.
 */
export default function PuzzleSolver({
  puzzle,
  onComplete,
  hintRequest = 0,
  revealRequest = 0,
  rewindRequest = 0,
  restartRequest = 0,
  onProgress,
  size
}: PuzzleSolverProps): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  // A hook cannot sit behind ??, so the responsive size is always computed
  // and only then overridden by an explicit prop.
  const responsiveSize = useBoardSize()
  const boardSize = size ?? responsiveSize

  const gameRef = useRef(new Chess(puzzle.fen))
  const [fen, setFen] = useState(puzzle.fen)
  const [state, setState] = useState<SolveState>('loading')
  const [moveIndex, setMoveIndex] = useState(0)
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const [hintSquares, setHintSquares] = useState<{ from?: Square; to?: Square }>({})
  const [hintsUsed, setHintsUsed] = useState(0)
  const [wrongSquare, setWrongSquare] = useState<Square | null>(null)
  const [mistakes, setMistakes] = useState(0)
  const mistakesRef = useRef(0)
  mistakesRef.current = mistakes

  const startedAt = useRef(Date.now())
  const completed = useRef(false)
  /** Whether this puzzle has been finished once already, making the next run a replay. */
  const scoredOnce = useRef(false)
  /** Last move of the real solution line, restored after a rewind. */
  const lastGoodMove = useRef<{ from: Square; to: Square } | null>(null)
  // Timers are cancelled on unmount and on puzzle change so a pending reply
  // can never be applied to the next puzzle.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = (): void => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const later = useCallback((fn: () => void, ms: number): void => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  /** The side the player controls: whoever is to move after the setup move. */
  const playerColor: Color = useMemo(() => {
    const probe = new Chess(puzzle.fen)
    const first = parseUci(puzzle.moves[0])
    if (first) {
      try {
        probe.move({ from: first.from, to: first.to, promotion: first.promotion ?? 'q' })
      } catch {
        /* fall through to the raw side to move */
      }
    }
    return probe.turn()
  }, [puzzle])

  // Reset everything when the puzzle changes.
  useEffect(() => {
    clearTimers()
    gameRef.current = new Chess(puzzle.fen)
    setFen(puzzle.fen)
    setState('loading')
    setMoveIndex(0)
    setLastMove(null)
    setHintSquares({})
    setHintsUsed(0)
    setWrongSquare(null)
    setMistakes(0)
    lastGoodMove.current = null
    startedAt.current = Date.now()
    completed.current = false
    scoredOnce.current = false

    // Play the opponent's blunder so the player sees it happen.
    later(() => {
      const first = parseUci(puzzle.moves[0])
      if (!first) {
        setState('waiting')
        return
      }
      try {
        const move = gameRef.current.move({
          from: first.from,
          to: first.to,
          promotion: first.promotion ?? 'q'
        })
        setFen(gameRef.current.fen())
        setLastMove({ from: first.from, to: first.to })
        lastGoodMove.current = { from: first.from, to: first.to }
        playMoveSound({ captured: Boolean(move?.captured), check: gameRef.current.inCheck() })
      } catch {
        /* malformed puzzle; let the player try from the given position */
      }
      setMoveIndex(1)
      // The clock starts when the player can actually act.
      startedAt.current = Date.now()
      setState('waiting')
    }, SETUP_DELAY_MS)

    return clearTimers
  }, [puzzle, later])

  const finish = useCallback(
    (solved: boolean) => {
      if (completed.current) return
      completed.current = true
      // The first run is the one that counts; anything after it is practice.
      const replay = scoredOnce.current
      scoredOnce.current = true
      onComplete({
        puzzleId: puzzle.id,
        solved,
        ms: Date.now() - startedAt.current,
        hints: hintsUsed,
        replay
      })
    },
    [onComplete, puzzle.id, hintsUsed]
  )

  /** Apply the opponent's scripted reply, then hand control back. */
  const playOpponent = useCallback(
    (index: number) => {
      const uci = puzzle.moves[index]
      if (!uci) {
        setState('solved')
        play('success')
        finish(true)
        return
      }
      const parsed = parseUci(uci)
      if (!parsed) return

      later(() => {
        const move = gameRef.current.move({
          from: parsed.from,
          to: parsed.to,
          promotion: parsed.promotion ?? 'q'
        })
        setFen(gameRef.current.fen())
        setLastMove({ from: parsed.from, to: parsed.to })
        lastGoodMove.current = { from: parsed.from, to: parsed.to }
        playMoveSound({ captured: Boolean(move?.captured), check: gameRef.current.inCheck() })

        const next = index + 1
        setMoveIndex(next)
        if (next >= puzzle.moves.length) {
          setState('solved')
          play('success')
          finish(true)
          onProgress?.({ mistakes: mistakesRef.current, solved: true, canRewind: false })
        } else {
          setState('waiting')
        }
      }, REPLY_DELAY_MS)
    },
    [puzzle.moves, later, finish, onProgress]
  )

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceType) => {
      if (state !== 'waiting' && state !== 'wrong') return

      const expected = puzzle.moves[moveIndex]
      if (!expected) return

      const played = `${from}${to}${promotion ?? ''}`
      // Compare without the promotion suffix too: the board may auto-queen
      // where the solution spells the promotion out, and vice versa.
      const matches = played === expected || `${from}${to}` === expected.slice(0, 4)

      // Any move that mates is accepted, matching how Lichess scores puzzles —
      // if you found a different forced mate, you solved it.
      let mates = false
      if (!matches) {
        const probe = new Chess(gameRef.current.fen())
        try {
          probe.move({ from, to, promotion: promotion ?? 'q' })
          mates = probe.isCheckmate()
        } catch {
          mates = false
        }
      }

      if (!matches && !mates) {
        // Play the mistake rather than rejecting it, so the player sees what
        // their move actually does, then take it back. Seeing the refutation is
        // most of the lesson; being told "wrong" and shown the answer is not.
        let attempted
        try {
          attempted = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
        } catch {
          attempted = null
        }

        if (attempted) {
          setFen(gameRef.current.fen())
          setLastMove({ from, to })
        }
        setWrongSquare(to)
        setState('wrong')
        play('failure')

        const nextMistakes = mistakes + 1
        setMistakes(nextMistakes)
        // The attempt is scored on the first mistake, and only once, so the
        // rating still means something even though play continues.
        finish(false)
        onProgress?.({ mistakes: nextMistakes, solved: false, canRewind: moveIndex > 1 })

        later(() => {
          if (attempted) {
            gameRef.current.undo()
            setFen(gameRef.current.fen())
            setLastMove(lastGoodMove.current)
          }
          setWrongSquare(null)
          setHintSquares({})
          setState('waiting')
        }, WRONG_HOLD_MS)
        return
      }

      const move = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) return

      setFen(gameRef.current.fen())
      setLastMove({ from, to })
      lastGoodMove.current = { from, to }
      setHintSquares({})
      playMoveSound({
        captured: Boolean(move.captured),
        check: gameRef.current.inCheck(),
        promotion: Boolean(move.promotion)
      })

      if (mates && !matches) {
        setState('solved')
        play('success')
        finish(true)
        onProgress?.({ mistakes, solved: true, canRewind: false })
        return
      }

      const next = moveIndex + 1
      setMoveIndex(next)
      if (next >= puzzle.moves.length) {
        setState('solved')
        play('success')
        finish(true)
        onProgress?.({ mistakes, solved: true, canRewind: false })
      } else {
        setState('setup')
        playOpponent(next)
      }
    },
    [state, puzzle.moves, moveIndex, playOpponent, later, finish, mistakes, onProgress]
  )

  /**
   * Hints escalate rather than jumping straight to the answer.
   *
   * The first two levels are text, rendered by the parent from the puzzle's
   * themes: what the position is asking for, then the idea that delivers it.
   * Only after those does the board start pointing at squares, because a
   * highlighted square tells you where to look without teaching you why.
   */
  useEffect(() => {
    if (hintRequest === 0 || state !== 'waiting') return
    setHintsUsed(hintRequest)

    const expected = puzzle.moves[moveIndex]
    const parsed = expected ? parseUci(expected) : null
    if (!parsed) return

    if (hintRequest >= SQUARE_HINT_LEVEL + 1) setHintSquares({ from: parsed.from, to: parsed.to })
    else if (hintRequest >= SQUARE_HINT_LEVEL) setHintSquares({ from: parsed.from })
  }, [hintRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal plays out the remaining solution.
  useEffect(() => {
    if (revealRequest === 0) return
    if (state === 'solved' || state === 'failed') return

    finish(false)
    setState('failed')

    let index = moveIndex
    const step = (): void => {
      const uci = puzzle.moves[index]
      if (!uci) return
      const parsed = parseUci(uci)
      if (!parsed) return
      try {
        gameRef.current.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion ?? 'q' })
        setFen(gameRef.current.fen())
        setLastMove({ from: parsed.from, to: parsed.to })
        play('move')
      } catch {
        return
      }
      index++
      if (index < puzzle.moves.length) later(step, REPLY_DELAY_MS)
    }
    later(step, 200)
  }, [revealRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Step back one full move pair: your move and the opponent's reply. Useful
   * when you realise partway through a long line that you went wrong earlier.
   */
  useEffect(() => {
    if (rewindRequest === 0) return
    if (state === 'solved' || state === 'failed') return
    if (moveIndex <= 1) return

    clearTimers()
    // Undo the opponent's scripted reply and then your own move.
    gameRef.current.undo()
    gameRef.current.undo()

    const history = gameRef.current.history({ verbose: true })
    const previous = history.at(-1)
    lastGoodMove.current = previous ? { from: previous.from as Square, to: previous.to as Square } : null

    setFen(gameRef.current.fen())
    setLastMove(lastGoodMove.current)
    setMoveIndex(moveIndex - 2)
    setHintSquares({})
    setWrongSquare(null)
    setState('waiting')
    play('move')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewindRequest])

  /**
   * Back to the position the puzzle started from.
   *
   * Mid-attempt this keeps the mistakes already made — you are re-walking the
   * same attempt. After the puzzle is over it is a fresh run instead: the
   * result is already recorded, so counting the old mistakes against a practice
   * repeat would be meaningless.
   */
  useEffect(() => {
    if (restartRequest === 0) return

    const replaying = completed.current

    clearTimers()
    const game = new Chess(puzzle.fen)
    const first = parseUci(puzzle.moves[0])
    if (first) {
      try {
        game.move({ from: first.from, to: first.to, promotion: first.promotion ?? 'q' })
      } catch {
        /* malformed puzzle; fall back to the raw position */
      }
    }
    gameRef.current = game
    lastGoodMove.current = first ? { from: first.from, to: first.to } : null

    setFen(game.fen())
    setLastMove(lastGoodMove.current)
    setMoveIndex(1)
    setHintSquares({})
    setWrongSquare(null)
    setState('waiting')
    play('move')

    if (replaying) {
      // Re-arm `finish`, and start the clock and the counters over.
      completed.current = false
      setMistakes(0)
      setHintsUsed(0)
      startedAt.current = Date.now()
    }

    // The parent derives "this puzzle is over" from progress, so it has to hear
    // that the board is live again or the controls stay locked.
    onProgress?.({
      mistakes: replaying ? 0 : mistakesRef.current,
      solved: false,
      canRewind: false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartRequest])

  const highlights = useMemo(() => {
    const result: Partial<Record<Square, string>> = {}
    if (hintSquares.from) result[hintSquares.from] = 'rgba(90,160,240,0.5)'
    if (hintSquares.to) result[hintSquares.to] = 'rgba(90,160,240,0.35)'
    if (wrongSquare) result[wrongSquare] = 'rgba(220,70,60,0.55)'
    return result
  }, [hintSquares, wrongSquare])

  return (
    <Board
      fen={fen}
      orientation={playerColor}
      movableFor={state === 'waiting' ? playerColor : null}
      onMove={onMove}
      lastMove={lastMove}
      highlights={highlights}
      colors={colors}
      pieceSet={settings.pieceSetId}
      size={boardSize}
      showCoordinates={settings.showCoordinates}
      showLegalMoves={settings.showLegalMoves}
      highlightLastMove={settings.highlightLastMove}
      animationMs={settings.animationMs}
      autoPromoteToQueen={settings.autoPromoteToQueen}
      moveInput={settings.moveInput}
      disabled={state === 'loading' || state === 'setup' || state === 'wrong'}
    />
  )
}

/** The side the player must move for a puzzle, without mounting the solver. */
export function puzzlePlayerColor(puzzle: Puzzle): Color {
  const probe = new Chess(puzzle.fen)
  const first = parseUci(puzzle.moves[0])
  if (first) {
    try {
      probe.move({ from: first.from, to: first.to, promotion: first.promotion ?? 'q' })
    } catch {
      /* ignore */
    }
  }
  return probe.turn()
}

/** SAN for the puzzle's solution, for the "show solution" panel. */
export function solutionSan(puzzle: Puzzle): string[] {
  const game = new Chess(puzzle.fen)
  const san: string[] = []
  for (const uci of puzzle.moves) {
    const parsed = parseUci(uci)
    if (!parsed) break
    try {
      const move = game.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion ?? 'q' })
      if (!move) break
      san.push(move.san)
    } catch {
      break
    }
  }
  // Drop the setup move; the player never had to find it.
  return san.slice(1)
}

export { uciToSan }
