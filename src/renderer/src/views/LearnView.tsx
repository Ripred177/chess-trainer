import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  GraduationCap,
  Target,
  BookOpen,
  Swords,
  RotateCcw,
  Undo2
} from 'lucide-react'
import type { Puzzle } from '@shared/types'
import Board from '../components/Board'
import PuzzleSolver, { type PuzzleResult } from '../components/PuzzleSolver'
import { PageHeader, Spinner } from '../components/ui'
import { useBoardColors, useBoardSize, useSettings, useStore } from '../state/useStore'
import { play, playMoveSound } from '../lib/sound'
import { CURRICULUM, suggestedModule, type Lesson, type Module, type DrillPosition } from '../data/curriculum'
import { materialBalance, outcomeOf, parseUci, piecesFromFen, type PieceType, type Square } from '../lib/chess'

export default function LearnView(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const [active, setActive] = useState<{ module: Module; lesson: Lesson } | null>(null)

  const rating = profile?.puzzleRating.rating ?? 1200
  const recommended = useMemo(() => suggestedModule(rating), [rating])

  if (active) {
    return (
      <LessonRunner
        module={active.module}
        lesson={active.lesson}
        onExit={() => setActive(null)}
        onNext={() => {
          const lessons = active.module.lessons
          const index = lessons.findIndex((l) => l.id === active.lesson.id)
          if (index >= 0 && index < lessons.length - 1) {
            setActive({ module: active.module, lesson: lessons[index + 1] })
          } else {
            setActive(null)
          }
        }}
      />
    )
  }

  const totalLessons = CURRICULUM.reduce((n, m) => n + m.lessons.length, 0)
  const completed = Object.values(profile?.lessons ?? {}).filter((l) => l.completion >= 1).length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Learn"
        subtitle={`A path from the rules to expert technique — ${totalLessons} lessons across ${CURRICULUM.length} modules. ${completed} completed.`}
      />

      <div
        className="card p-4 mb-6 flex items-center gap-3"
        style={{ borderColor: 'var(--color-accent-500)' }}
      >
        <GraduationCap size={20} style={{ color: 'var(--color-accent-400)' }} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Suggested for you: {recommended.title}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Based on your puzzle rating of {rating}. {recommended.blurb}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setActive({ module: recommended, lesson: recommended.lessons[0] })}
        >
          Start
        </button>
      </div>

      {CURRICULUM.map((module) => (
        <div key={module.id} className="mb-6">
          <div className="flex items-baseline gap-3 mb-1">
            <h2 className="text-lg font-semibold tracking-tight">{module.title}</h2>
            <span className="chip tabular">
              {module.band[0]}–{module.band[1]}
            </span>
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            {module.blurb}
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {module.lessons.map((lesson) => {
              const progress = profile?.lessons[lesson.id]
              const done = (progress?.completion ?? 0) >= 1
              const Icon =
                lesson.body.kind === 'concept' ? BookOpen : lesson.body.kind === 'drill' ? Swords : Target

              return (
                <button
                  key={lesson.id}
                  onClick={() => setActive({ module, lesson })}
                  className="card p-4 text-left transition-all"
                  style={{ borderColor: done ? 'var(--color-accent-500)' : 'var(--border-subtle)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                    {done && <Check size={15} style={{ color: 'var(--color-accent-400)' }} />}
                  </div>
                  <div className="font-semibold text-sm mt-2">{lesson.title}</div>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {lesson.summary}
                  </p>
                  {progress && progress.attempts > 0 && !done && (
                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.round(progress.completion * 100)}%`,
                          background: 'var(--color-accent-500)'
                        }}
                      />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================== runner ======

function LessonRunner({
  module,
  lesson,
  onExit,
  onNext
}: {
  module: Module
  lesson: Lesson
  onExit: () => void
  onNext: () => void
}): React.JSX.Element {
  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <button className="btn btn-ghost" onClick={onExit}>
          <ChevronLeft size={16} /> All lessons
        </button>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {module.title}
        </div>
      </div>

      {lesson.body.kind === 'concept' && <ConceptRunner lesson={lesson} onNext={onNext} />}
      {lesson.body.kind === 'drill' && <DrillRunner lesson={lesson} onNext={onNext} />}
      {lesson.body.kind === 'practice' && <PracticeRunner lesson={lesson} onNext={onNext} />}
    </div>
  )
}

/** Steps through annotated positions one idea at a time. */
function ConceptRunner({ lesson, onNext }: { lesson: Lesson; onNext: () => void }): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const refreshProfile = useStore((s) => s.refreshProfile)
  const body = lesson.body as Extract<Lesson['body'], { kind: 'concept' }>

  const [index, setIndex] = useState(0)
  const [played, setPlayed] = useState(false)
  const step = body.steps[index]

  // Each step may demonstrate a move; showing it on a short delay reads far
  // better than rendering the position already changed.
  const displayFen = useMemo(() => {
    if (!played || !step.playMove) return step.fen
    const game = new Chess(step.fen)
    const parsed = parseUci(step.playMove)
    if (!parsed) return step.fen
    try {
      game.move({ from: parsed.from, to: parsed.to, promotion: parsed.promotion ?? 'q' })
      return game.fen()
    } catch {
      return step.fen
    }
  }, [step, played])

  useEffect(() => {
    setPlayed(false)
    if (!step.playMove) return
    const timer = setTimeout(() => {
      setPlayed(true)
      play('move')
    }, 900)
    return () => clearTimeout(timer)
  }, [step])

  const highlights = useMemo(() => {
    const result: Partial<Record<Square, string>> = {}
    for (const square of step.highlight ?? []) result[square as Square] = 'rgba(90,160,240,0.42)'
    return result
  }, [step])

  const last = index === body.steps.length - 1

  const finish = async (): Promise<void> => {
    await window.chess.profile.recordLesson(lesson.id, true, 1)
    await refreshProfile()
    onNext()
  }

  return (
    <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
      <Board
        fen={displayFen}
        movableFor={null}
        colors={colors}
        pieceSet={settings.pieceSetId}
        size={boardSize}
        showCoordinates={settings.showCoordinates}
        highlights={highlights}
        animationMs={settings.animationMs}
      />

      <div className="w-full max-w-[24rem] lg:w-96 shrink-0">
        <div className="card p-5">
          <div className="label mb-1">
            Step {index + 1} of {body.steps.length}
          </div>
          <h2 className="text-lg font-semibold tracking-tight mb-3">{lesson.title}</h2>
          <p className="text-sm leading-relaxed selectable" style={{ color: 'var(--text-secondary)' }}>
            {step.text}
          </p>

          <div className="flex gap-2 mt-5">
            <button className="btn flex-1" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
              <ChevronLeft size={15} /> Back
            </button>
            {last ? (
              <button className="btn btn-primary flex-1" onClick={finish}>
                <Check size={15} /> Finish
              </button>
            ) : (
              <button className="btn btn-primary flex-1" onClick={() => setIndex((i) => i + 1)}>
                Next <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {body.steps.map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: 3,
                background: i <= index ? 'var(--color-accent-500)' : 'var(--surface-3)'
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Pulls fresh puzzles matching the lesson's motif. */
function PracticeRunner({ lesson, onNext }: { lesson: Lesson; onNext: () => void }): React.JSX.Element {
  const boardSize = useBoardSize()
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const puzzlesAvailable = useStore((s) => s.puzzlesAvailable)
  const body = lesson.body as Extract<Lesson['body'], { kind: 'practice' }>

  const [puzzles, setPuzzles] = useState<Puzzle[]>([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [loading, setLoading] = useState(true)
  // A mistake is scored but rewound, so practice teaches rather than just tests.
  const [progress, setProgress] = useState({ mistakes: 0, solved: false, canRewind: false })
  const [rewindRequest, setRewindRequest] = useState(0)
  const [restartRequest, setRestartRequest] = useState(0)

  const rating = profile?.puzzleRating.rating ?? 1200

  useEffect(() => {
    if (!puzzlesAvailable) {
      setLoading(false)
      return
    }
    // Centre the difficulty on the player unless the lesson pins a band.
    const query = {
      ...body.query,
      minRating: body.query.minRating ?? Math.max(400, rating - 250),
      maxRating: body.query.maxRating ?? rating + 250,
      limit: body.count
    }
    void window.chess.puzzles
      .find(query)
      .then(setPuzzles)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, puzzlesAvailable])

  const onComplete = useCallback(
    async (result: PuzzleResult) => {
      const puzzle = puzzles[index]
      if (!puzzle) return
      setResults((r) => [...r, result.solved])
      await window.chess.profile.recordPuzzleAttempt({
        puzzleId: puzzle.id,
        puzzleRating: puzzle.rating,
        puzzleRd: puzzle.ratingDeviation,
        themes: puzzle.themes,
        solved: result.solved,
        ms: result.ms,
        hints: result.hints
      })
      await refreshProfile()
    },
    [puzzles, index, refreshProfile]
  )

  const done = results.length >= puzzles.length && puzzles.length > 0

  const finish = async (): Promise<void> => {
    const correct = results.filter(Boolean).length
    await window.chess.profile.recordLesson(lesson.id, correct >= Math.ceil(puzzles.length * 0.7), 1)
    await refreshProfile()
    onNext()
  }

  if (loading) {
    return (
      <div className="grid place-items-center" style={{ height: 400 }}>
        <Spinner size={22} />
      </div>
    )
  }

  if (!puzzlesAvailable || puzzles.length === 0) {
    return (
      <div className="card p-8 max-w-lg mx-auto text-center">
        <div className="font-semibold">No practice positions available</div>
        <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
          This lesson draws from the puzzle database. Build it with &quot;npm run puzzles:build&quot; to
          enable practice.
        </p>
      </div>
    )
  }

  const puzzle = puzzles[index]
  const answered = results.length > index

  return (
    <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
      {puzzle ? (
        <PuzzleSolver
          key={puzzle.id}
          puzzle={puzzle}
          onComplete={onComplete}
          onProgress={setProgress}
          rewindRequest={rewindRequest}
          restartRequest={restartRequest}
        />
      ) : (
        <div
          className="card grid place-items-center"
          style={{ width: boardSize, height: boardSize }}
        >
          <span className="text-sm">Set complete.</span>
        </div>
      )}

      <div className="w-full max-w-[24rem] lg:w-96 shrink-0">
        <div className="card p-5">
          <div className="label mb-1">
            Puzzle {Math.min(index + 1, puzzles.length)} of {puzzles.length}
          </div>
          <h2 className="text-lg font-semibold tracking-tight mb-2">{lesson.title}</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {lesson.summary}
          </p>

          <div className="flex gap-1 mt-4">
            {puzzles.map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-full"
                style={{
                  height: 4,
                  background:
                    i >= results.length
                      ? 'var(--surface-3)'
                      : results[i]
                        ? 'var(--color-accent-500)'
                        : 'var(--color-danger-500)'
                }}
              />
            ))}
          </div>

          {!done && !progress.solved && (
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                className="btn"
                onClick={() => setRewindRequest((n) => n + 1)}
                disabled={!progress.canRewind}
                title="Step back one move so you can try a different continuation"
              >
                <Undo2 size={15} /> Rewind
              </button>
              <button className="btn" onClick={() => setRestartRequest((n) => n + 1)}>
                <RotateCcw size={15} /> Restart
              </button>
            </div>
          )}

          {progress.mistakes > 0 && !progress.solved && (
            <p className="text-xs mt-3" style={{ color: 'var(--color-warn-400)' }}>
              Not quite — the move was taken back. Work it out before moving on.
            </p>
          )}

          {done ? (
            <div className="mt-5">
              <div className="font-semibold">
                {results.filter(Boolean).length} of {puzzles.length} solved
              </div>
              <button className="btn btn-primary w-full mt-3" onClick={finish}>
                <Check size={15} /> Finish lesson
              </button>
            </div>
          ) : (
            answered && (
              <button
                className="btn btn-primary w-full mt-5"
                onClick={() => {
                  setProgress({ mistakes: 0, solved: false, canRewind: false })
                  setIndex((i) => i + 1)
                }}
                disabled={index >= puzzles.length - 1 && results.length < puzzles.length}
              >
                Next <ChevronRight size={15} />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

/** Play a position out against the engine until the goal is met. */
function DrillRunner({ lesson, onNext }: { lesson: Lesson; onNext: () => void }): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const refreshProfile = useStore((s) => s.refreshProfile)
  const body = lesson.body as Extract<Lesson['body'], { kind: 'drill' }>

  const [positionIndex, setPositionIndex] = useState(0)
  const position: DrillPosition = body.positions[positionIndex]

  const gameRef = useRef(new Chess(position.fen))
  const [fen, setFen] = useState(position.fen)
  const [thinking, setThinking] = useState(false)
  const [status, setStatus] = useState<'playing' | 'success' | 'failed'>('playing')
  const [message, setMessage] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const generation = useRef(0)

  const playerColor = useMemo(() => new Chess(position.fen).turn(), [position.fen])
  const startingMaterial = useMemo(() => materialBalance(position.fen).advantage, [position.fen])

  const reset = useCallback(() => {
    generation.current++
    gameRef.current = new Chess(position.fen)
    setFen(position.fen)
    setStatus('playing')
    setMessage(null)
    setLastMove(null)
    setThinking(false)
  }, [position.fen])

  useEffect(reset, [reset])

  /** Decide whether the drill's goal has been met, failed, or is unresolved. */
  const evaluateGoal = useCallback((): boolean => {
    const game = gameRef.current
    const outcome = outcomeOf(game)
    const moveCount = Math.ceil(game.history().length / 2)

    if (outcome.over) {
      if (outcome.termination === 'Checkmate') {
        const won = outcome.winner === playerColor
        setStatus(won ? 'success' : 'failed')
        setMessage(won ? 'Checkmate. Well done.' : 'You were checkmated.')
        play(won ? 'success' : 'failure')
        return true
      }
      // Any draw fails a win-or-mate goal, and satisfies a draw goal.
      const wanted = position.goal === 'draw'
      setStatus(wanted ? 'success' : 'failed')
      setMessage(`${outcome.termination}.${wanted ? '' : ' The goal was to win this position.'}`)
      play(wanted ? 'success' : 'failure')
      return true
    }

    if (position.goal === 'promote') {
      // Success once a new queen appears for the player.
      const queens = piecesFromFen(game.fen()).filter(
        (p) => p.color === playerColor && p.type === 'q'
      ).length
      const startQueens = piecesFromFen(position.fen).filter(
        (p) => p.color === playerColor && p.type === 'q'
      ).length
      if (queens > startQueens) {
        setStatus('success')
        setMessage('Promoted. That is the technique.')
        play('success')
        return true
      }
    }

    if (position.goal === 'win') {
      const advantage = materialBalance(game.fen()).advantage
      const gain = playerColor === 'w' ? advantage - startingMaterial : startingMaterial - advantage
      if (gain <= -3) {
        setStatus('failed')
        setMessage('You have lost material. Try again.')
        play('failure')
        return true
      }
    }

    if (position.moveLimit && moveCount >= position.moveLimit) {
      setStatus('failed')
      setMessage(`Move limit of ${position.moveLimit} reached.`)
      play('failure')
      return true
    }

    return false
  }, [playerColor, position, startingMaterial])

  const engineMove = useCallback(async () => {
    const myGeneration = generation.current
    setThinking(true)
    try {
      const result = await window.chess.engine.go({
        fen: gameRef.current.fen(),
        strength: { elo: position.defenderElo, moveTimeMs: 400 }
      })
      if (myGeneration !== generation.current || !result.bestmove) return
      const parsed = parseUci(result.bestmove)
      if (!parsed) return
      const move = gameRef.current.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion ?? 'q'
      })
      if (!move) return
      setFen(gameRef.current.fen())
      setLastMove({ from: parsed.from, to: parsed.to })
      playMoveSound({ captured: Boolean(move.captured), check: gameRef.current.inCheck() })
      evaluateGoal()
    } finally {
      if (myGeneration === generation.current) setThinking(false)
    }
  }, [position.defenderElo, evaluateGoal])

  useEffect(() => {
    if (status !== 'playing') return
    if (gameRef.current.turn() === playerColor) return
    if (gameRef.current.isGameOver()) return
    if (thinking) return
    void engineMove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, status, playerColor])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceType) => {
      if (status !== 'playing' || gameRef.current.turn() !== playerColor) return
      const move = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) return
      setFen(gameRef.current.fen())
      setLastMove({ from, to })
      playMoveSound({
        captured: Boolean(move.captured),
        check: gameRef.current.inCheck(),
        promotion: Boolean(move.promotion)
      })
      evaluateGoal()
    },
    [status, playerColor, evaluateGoal]
  )

  const finish = async (): Promise<void> => {
    await window.chess.profile.recordLesson(lesson.id, status === 'success', status === 'success' ? 1 : 0.5)
    await refreshProfile()
    if (positionIndex < body.positions.length - 1) {
      setPositionIndex((i) => i + 1)
    } else {
      onNext()
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
      <Board
        fen={fen}
        orientation={playerColor}
        movableFor={status === 'playing' ? playerColor : null}
        onMove={onMove}
        lastMove={lastMove}
        colors={colors}
        pieceSet={settings.pieceSetId}
        size={boardSize}
        showCoordinates={settings.showCoordinates}
        showLegalMoves={settings.showLegalMoves}
        highlightLastMove={settings.highlightLastMove}
        animationMs={settings.animationMs}
        autoPromoteToQueen={settings.autoPromoteToQueen}
        moveInput={settings.moveInput}
        disabled={thinking}
      />

      <div className="w-full max-w-[24rem] lg:w-96 shrink-0">
        <div className="card p-5">
          <div className="label mb-1">
            Drill {positionIndex + 1} of {body.positions.length}
          </div>
          <h2 className="text-lg font-semibold tracking-tight mb-2">{lesson.title}</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {position.brief}
          </p>

          <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="chip">
              {position.goal === 'checkmate'
                ? 'Deliver mate'
                : position.goal === 'promote'
                  ? 'Promote a pawn'
                  : position.goal === 'draw'
                    ? 'Hold the draw'
                    : 'Win the position'}
            </span>
            <span className="chip">Defender {position.defenderElo}</span>
            {position.moveLimit && <span className="chip">≤ {position.moveLimit} moves</span>}
          </div>

          {message && (
            <div
              className="mt-4 p-3 rounded-lg text-sm"
              style={{
                background: 'var(--surface-2)',
                color: status === 'success' ? 'var(--color-accent-400)' : 'var(--color-danger-400)'
              }}
            >
              {message}
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <button className="btn flex-1" onClick={reset}>
              <RotateCcw size={15} /> Restart
            </button>
            {status !== 'playing' && (
              <button className="btn btn-primary flex-1" onClick={finish}>
                {positionIndex < body.positions.length - 1 ? 'Next drill' : 'Finish'}{' '}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
