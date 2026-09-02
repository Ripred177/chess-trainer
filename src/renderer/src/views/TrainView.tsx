import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  ArrowLeft,
  Bird,
  BookOpen,
  Check,
  Crown,
  Layers,
  Lightbulb,
  RotateCcw,
  Search,
  Target,
  Trash2,
  X
} from 'lucide-react'
import type { OpeningSummary, Puzzle, PuzzleQuery, WoodpeckerSet } from '@shared/types'
import Board from '../components/Board'
import PuzzleSolver, { type PuzzleResult } from '../components/PuzzleSolver'
import { PageHeader, Spinner } from '../components/ui'
import { useBoardColors, useBoardSize, useSettings, useStore } from '../state/useStore'
import { play, playMoveSound } from '../lib/sound'
import { materialBalance, outcomeOf, parseUci, type PieceType, type Square } from '../lib/chess'
import {
  ENDGAME_CHAPTERS,
  type EndgameChapter,
  type EndgamePosition
} from '../data/endgames'
import {
  MIDDLEGAME_GROUPS,
  WOODPECKER_PRESETS,
  WOODPECKER_SIZES,
  type StudySet
} from '../data/studyMethods'

type Method = 'menu' | 'woodpecker' | 'endgames' | 'openings' | 'middlegame'

/** Rating spread around the player used when a method samples puzzles. */
const BAND = 150

function formatDuration(ms: number): string {
  if (ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function TrainView(): React.JSX.Element {
  const [method, setMethod] = useState<Method>('menu')
  const profile = useStore((s) => s.profile)

  // A set in progress is the most useful thing this screen can tell you, and
  // without it there is no way to know from here that anything is saved.
  const woodpecker = profile?.training.woodpecker ?? null
  const woodpeckerMeta = woodpecker
    ? woodpecker.completedAt
      ? `Set finished · all ${woodpecker.cycles.length} cycles done`
      : `In progress · cycle ${woodpecker.cycles.length} of 7 · ${woodpecker.cursor} / ${woodpecker.puzzleIds.length}`
    : 'Smith & Tikkanen · a long commitment'

  if (method !== 'menu') {
    return (
      <div className="p-3 sm:p-6">
        <button className="btn btn-ghost mb-4" onClick={() => setMethod('menu')}>
          <ArrowLeft size={15} /> All methods
        </button>
        {method === 'woodpecker' && <WoodpeckerPanel />}
        {method === 'endgames' && <EndgamePanel />}
        {method === 'openings' && <OpeningPanel />}
        {method === 'middlegame' && <MiddlegamePanel />}
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6">
      <PageHeader
        title="Train"
        subtitle="Structured study methods, as opposed to solving whatever comes next."
      />
      <div className="grid gap-3 md:grid-cols-2 max-w-4xl">
        <MethodCard
          icon={Bird}
          title="The Woodpecker Method"
          blurb="Solve one fixed set of tactics, then solve it again and again, faster each time. Nothing new is added — the point is to meet the old positions until recognition replaces calculation."
          meta={woodpeckerMeta}
          highlight={woodpecker != null && !woodpecker.completedAt}
          onClick={() => setMethod('woodpecker')}
        />
        <MethodCard
          icon={Crown}
          title="Theoretical endgames"
          blurb="Sixteen positions whose result is already known. Play each one out against the engine until you reach the theoretical result — Lucena, Philidor, the opposition, the drawing corner."
          meta="5 chapters · verified against the engine"
          onClick={() => setMethod('endgames')}
        />
        <MethodCard
          icon={BookOpen}
          title="Opening tactics"
          blurb="Train the positions that actually arise from your repertoire. Every puzzle is drawn from real games in the opening you pick."
          meta="1,589 openings · 1.2M tagged puzzles"
          onClick={() => setMethod('openings')}
        />
        <MethodCard
          icon={Layers}
          title="Middlegame studies"
          blurb="Themed sets for attack, defence, and the recurring tactical motifs — drilled one shape at a time rather than mixed together."
          meta="15 sets across 4 groups"
          onClick={() => setMethod('middlegame')}
        />
      </div>
    </div>
  )
}

function MethodCard({
  icon: Icon,
  title,
  blurb,
  meta,
  highlight = false,
  onClick
}: {
  icon: typeof Bird
  title: string
  blurb: string
  meta: string
  /** Draws attention to a method with work already under way. */
  highlight?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="card p-5 text-left transition-colors hover:brightness-110"
      style={highlight ? { borderColor: 'var(--color-accent-500)' } : undefined}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <Icon size={19} style={{ color: 'var(--color-accent-400)' }} />
        <span className="font-semibold">{title}</span>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {blurb}
      </p>
      <div
        className="text-xs mt-3"
        style={{
          color: highlight ? 'var(--color-accent-400)' : 'var(--text-muted)',
          fontWeight: highlight ? 600 : undefined
        }}
      >
        {meta}
      </div>
    </button>
  )
}

// ------------------------------------------------------------- woodpecker ---

function WoodpeckerPanel(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const set = profile?.training.woodpecker ?? null

  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(250)
  const [preset, setPreset] = useState('mixed')

  const create = async (): Promise<void> => {
    if (!profile) return
    setBuilding(true)
    setError(null)
    try {
      const rating = profile.puzzleRating.rating
      const themes = WOODPECKER_PRESETS.find((p) => p.id === preset)?.themes ?? []
      // Slightly below the player's rating on purpose: the set is solved seven
      // times, and positions that are a struggle on cycle one never become
      // automatic.
      const puzzles = await window.chess.puzzles.find({
        minRating: Math.max(400, rating - 250),
        maxRating: rating + 50,
        themes,
        limit: size
      })
      if (puzzles.length === 0) {
        setError('No puzzles matched. Try a different motif.')
        return
      }
      await window.chess.training.startWoodpecker({
        label: `${puzzles.length} puzzles · ${WOODPECKER_PRESETS.find((p) => p.id === preset)?.label ?? 'Mixed'}`,
        puzzleIds: puzzles.map((p) => p.id),
        minRating: Math.max(400, rating - 250),
        maxRating: rating + 50,
        themes
      })
      await refreshProfile()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }

  if (!set) {
    return (
      <div className="max-w-2xl">
        <PageHeader
          title="The Woodpecker Method"
          subtitle="One fixed set, solved repeatedly, faster every cycle."
        />
        <div className="card p-5 mb-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            You solve the same puzzles seven times. The first cycle is slow and painful; by the
            last it should take a fraction as long, because you are recognising positions rather
            than working them out. Nothing is ever added to the set — that is the entire method.
          </p>
        </div>

        <div className="card p-5 mb-4">
          <div className="label mb-2">Set size</div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {WOODPECKER_SIZES.map((option) => (
              <button
                key={option.size}
                onClick={() => setSize(option.size)}
                className="p-3 rounded-lg text-left transition-colors"
                style={{
                  background: size === option.size ? 'var(--surface-3)' : 'var(--surface-2)',
                  outline: size === option.size ? '1px solid var(--color-accent-500)' : 'none'
                }}
              >
                <div className="font-semibold text-sm">{option.label} puzzles</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {option.note}
                </div>
              </button>
            ))}
          </div>

          <div className="label mb-2">Focus</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {WOODPECKER_PRESETS.map((option) => (
              <button
                key={option.id}
                onClick={() => setPreset(option.id)}
                className="chip"
                style={{
                  background: preset === option.id ? 'var(--color-accent-600)' : 'var(--surface-2)',
                  color: preset === option.id ? '#fff' : 'var(--text-secondary)'
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button className="btn btn-primary w-full" onClick={() => void create()} disabled={building}>
            {building ? <Spinner /> : <Bird size={15} />}
            {building ? 'Building the set…' : `Start with ${size} puzzles`}
          </button>
          {error && (
            <div className="text-xs mt-2" style={{ color: 'var(--color-danger-400)' }}>
              {error}
            </div>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Puzzles are drawn a little below your rating of {profile?.puzzleRating.rating ?? 1200}.
            Positions that are a fight on the first pass never become automatic.
          </p>
        </div>

        {profile && profile.training.woodpeckerArchive.length > 0 && (
          <div className="card p-5">
            <div className="label mb-3">Previous sets</div>
            {profile.training.woodpeckerArchive
              .slice()
              .reverse()
              .map((old) => (
                <div key={old.id} className="text-xs mb-2 flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>{old.label}</span>
                  <span className="tabular" style={{ color: 'var(--text-muted)' }}>
                    {old.cycles.filter((c) => c.finishedAt).length} cycles
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    )
  }

  return <WoodpeckerRunner set={set} onChanged={refreshProfile} />
}

function WoodpeckerRunner({
  set,
  onChanged
}: {
  set: WoodpeckerSet
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(true)
  const [hintRequest, setHintRequest] = useState(0)
  const startedAt = useRef(Date.now())

  const cycle = set.cycles[set.cycles.length - 1]
  const done = set.completedAt != null

  useEffect(() => {
    if (done) return
    let cancelled = false
    setLoading(true)
    const id = set.puzzleIds[set.cursor]
    void window.chess.puzzles.byId(id).then((p) => {
      if (cancelled) return
      setPuzzle(p)
      setLoading(false)
      startedAt.current = Date.now()
    })
    return () => {
      cancelled = true
    }
  }, [set.cursor, set.puzzleIds, done])

  const onComplete = useCallback(
    async (result: PuzzleResult) => {
      await window.chess.training.recordWoodpecker({
        solved: result.solved,
        ms: Date.now() - startedAt.current
      })
      await onChanged()
    },
    [onChanged]
  )

  /** Same puzzles, cycle one again; the run so far is kept in the archive. */
  const restart = async (): Promise<void> => {
    await window.chess.training.restartWoodpecker()
    await onChanged()
  }

  /** Back to the setup screen to build a different set entirely. */
  const abandon = async (): Promise<void> => {
    await window.chess.training.archiveWoodpecker()
    await onChanged()
  }

  // Previous cycle times, which are the whole point of the method.
  const finished = set.cycles.filter((c) => c.finishedAt)
  const firstMs = finished[0]?.ms ?? 0
  const lastMs = finished[finished.length - 1]?.ms ?? 0

  return (
    <div>
      <PageHeader
        title={`Woodpecker · cycle ${cycle.index} of 7`}
        subtitle={set.label}
        actions={
          <div className="flex gap-2">
            <button
              className="btn"
              onClick={() => void restart()}
              title="Start this set again from cycle one. The run so far is kept in your history."
            >
              <RotateCcw size={15} /> Start over
            </button>
            <button
              className="btn"
              onClick={() => void abandon()}
              title="Put this set aside and build a different one"
            >
              <Trash2 size={15} /> New set
            </button>
          </div>
        }
      />

      {done ? (
        <div className="card p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--color-accent-400)' }}>
            <Check size={18} />
            <span className="font-semibold">Set complete — all seven cycles.</span>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            First cycle took {formatDuration(firstMs)}; the last took {formatDuration(lastMs)}
            {firstMs > 0 && lastMs > 0 && lastMs < firstMs
              ? ` — ${(firstMs / lastMs).toFixed(1)}× faster.`
              : '.'}
          </p>
          <CycleTable set={set} />
          <button className="btn btn-primary w-full mt-4" onClick={() => void abandon()}>
            Start a new set
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
          <div>
            {loading || !puzzle ? (
              <div className="grid place-items-center" style={{ width: 360, height: 360 }}>
                <Spinner />
              </div>
            ) : (
              <PuzzleSolver
                key={`${set.id}-${cycle.index}-${set.cursor}`}
                puzzle={puzzle}
                onComplete={(r) => void onComplete(r)}
                hintRequest={hintRequest}
              />
            )}
          </div>

          <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
            <div className="card p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="label">Cycle {cycle.index}</span>
                <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                  {set.cursor} / {set.puzzleIds.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--surface-3)' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${(set.cursor / set.puzzleIds.length) * 100}%`,
                    background: 'var(--color-accent-500)'
                  }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Solved" value={String(cycle.solved)} />
                <Stat label="Missed" value={String(cycle.failed)} />
                <Stat label="Time" value={formatDuration(cycle.ms)} />
              </div>
              <button
                className="btn w-full mt-3"
                onClick={() => setHintRequest((n) => n + 1)}
                disabled={!puzzle}
              >
                <Lightbulb size={15} /> Hint
              </button>
            </div>

            {finished.length > 0 && (
              <div className="card p-4">
                <div className="label mb-2">Cycle times</div>
                <CycleTable set={set} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CycleTable({ set }: { set: WoodpeckerSet }): React.JSX.Element {
  const finished = set.cycles.filter((c) => c.finishedAt)
  const best = Math.max(...finished.map((c) => c.ms), 1)
  return (
    <div className="space-y-1.5">
      {finished.map((c) => (
        <div key={c.index} className="flex items-center gap-2 text-xs">
          <span className="tabular w-4" style={{ color: 'var(--text-muted)' }}>
            {c.index}
          </span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
            <div
              className="h-full"
              style={{ width: `${(c.ms / best) * 100}%`, background: 'var(--color-accent-500)' }}
            />
          </div>
          <span className="tabular w-16 text-right" style={{ color: 'var(--text-secondary)' }}>
            {formatDuration(c.ms)}
          </span>
          <span className="tabular w-12 text-right" style={{ color: 'var(--text-muted)' }}>
            {c.solved}/{c.solved + c.failed}
          </span>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="tabular font-semibold">{value}</div>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

// --------------------------------------------------------------- endgames ---

function EndgamePanel(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const [active, setActive] = useState<EndgamePosition | null>(null)

  if (active) {
    return <EndgameDrill position={active} onBack={() => setActive(null)} />
  }

  const progress = profile?.training.endgames ?? {}
  const learned = Object.values(progress).filter((p) => p.successes > 0).length

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Theoretical endgames"
        subtitle={`Positions whose result is already known. ${learned} of 16 solved.`}
      />
      {ENDGAME_CHAPTERS.map((chapter: EndgameChapter) => (
        <div key={chapter.id} className="mb-5">
          <div className="font-semibold mb-1">{chapter.title}</div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {chapter.blurb}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {chapter.positions.map((position) => {
              const record = progress[position.id]
              const solved = (record?.successes ?? 0) > 0
              return (
                <button
                  key={position.id}
                  onClick={() => setActive(position)}
                  className="card p-3 text-left transition-colors hover:brightness-110"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{position.name}</span>
                    {solved ? (
                      <Check size={15} style={{ color: 'var(--color-accent-400)' }} />
                    ) : (
                      <span className="chip text-[10px]">{position.goal}</span>
                    )}
                  </div>
                  <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {position.idea}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Play a theoretical position out against the engine until the known result is
 * reached. Failing reveals the method — the drill tests recall first.
 */
function EndgameDrill({
  position,
  onBack
}: {
  position: EndgamePosition
  onBack: () => void
}): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const refreshProfile = useStore((s) => s.refreshProfile)

  const gameRef = useRef(new Chess(position.fen))
  const [fen, setFen] = useState(position.fen)
  const [thinking, setThinking] = useState(false)
  const [status, setStatus] = useState<'playing' | 'success' | 'failed'>('playing')
  const [message, setMessage] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const [showMethod, setShowMethod] = useState(false)
  const generation = useRef(0)
  const recorded = useRef(false)

  const playerColor = useMemo(() => new Chess(position.fen).turn(), [position.fen])
  const startMaterial = useMemo(() => materialBalance(position.fen).advantage, [position.fen])

  const reset = useCallback(() => {
    generation.current++
    recorded.current = false
    gameRef.current = new Chess(position.fen)
    setFen(position.fen)
    setStatus('playing')
    setMessage(null)
    setLastMove(null)
    setThinking(false)
  }, [position.fen])

  useEffect(reset, [reset])

  const settle = useCallback(
    (ok: boolean, text: string, result: 'win' | 'draw' | 'loss') => {
      setStatus(ok ? 'success' : 'failed')
      setMessage(text)
      play(ok ? 'success' : 'failure')
      if (!ok) setShowMethod(true)
      if (!recorded.current) {
        recorded.current = true
        void window.chess.training.recordEndgame(position.id, result, ok).then(() => refreshProfile())
      }
    },
    [position.id, refreshProfile]
  )

  const evaluateGoal = useCallback((): boolean => {
    const game = gameRef.current
    const outcome = outcomeOf(game)
    const moveCount = Math.ceil(game.history().length / 2)

    if (outcome.over) {
      if (outcome.termination === 'Checkmate') {
        const won = outcome.winner === playerColor
        if (position.goal === 'win' && won) settle(true, 'Checkmate. That is the technique.', 'win')
        else if (won) settle(true, 'Checkmate — better than the draw you needed.', 'win')
        else settle(false, 'You were checkmated.', 'loss')
        return true
      }
      // Any drawn ending: success only when a draw was the theoretical result.
      const wanted = position.goal === 'draw'
      settle(
        wanted,
        wanted
          ? `${outcome.termination}. Held, exactly as theory says.`
          : `${outcome.termination}. This position is a win — the draw let it slip.`,
        'draw'
      )
      return true
    }

    // Shedding the material that made the position winnable ends it early.
    if (position.goal === 'win') {
      const advantage = materialBalance(game.fen()).advantage
      const gain = playerColor === 'w' ? advantage - startMaterial : startMaterial - advantage
      if (gain <= -3) {
        settle(false, 'You have given up the material the win depended on.', 'loss')
        return true
      }
    }

    if (moveCount >= position.moveLimit) {
      // Running out of moves fails a win but confirms a draw: surviving is the
      // whole task when the theoretical result is half a point.
      if (position.goal === 'draw') settle(true, 'Held. The defence is sound.', 'draw')
      else settle(false, `Move limit of ${position.moveLimit} reached without converting.`, 'draw')
      return true
    }

    return false
  }, [playerColor, position, startMaterial, settle])

  const engineMove = useCallback(async () => {
    const myGeneration = generation.current
    setThinking(true)
    try {
      const result = await window.chess.engine.go({
        fen: gameRef.current.fen(),
        strength: { elo: position.defenderElo, moveTimeMs: 500 }
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

  return (
    <div>
      <button className="btn btn-ghost mb-4" onClick={onBack}>
        <ArrowLeft size={15} /> Endgames
      </button>
      <PageHeader title={position.name} subtitle={position.idea} />

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
        />

        <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
          <div className="card p-4 mb-3">
            <div className="label mb-2">Your task</div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {position.goal === 'win'
                ? 'This position is a theoretical win. Convert it.'
                : 'This position is a theoretical draw. Hold it.'}
            </p>
            <div className="text-xs mt-2 tabular" style={{ color: 'var(--text-muted)' }}>
              Playing {playerColor === 'w' ? 'White' : 'Black'} · up to {position.moveLimit} moves
              {thinking ? ' · engine thinking…' : ''}
            </div>
          </div>

          {message && (
            <div
              className="card p-4 mb-3 text-sm"
              style={{
                color: status === 'success' ? 'var(--color-accent-400)' : 'var(--color-danger-400)'
              }}
            >
              {message}
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <button className="btn flex-1" onClick={reset}>
              <RotateCcw size={15} /> {status === 'playing' ? 'Restart' : 'Try again'}
            </button>
            <button className="btn flex-1" onClick={() => setShowMethod((v) => !v)}>
              <Lightbulb size={15} /> Method
            </button>
          </div>

          {showMethod && (
            <div className="card p-4">
              <div className="label mb-2">The technique</div>
              <ol className="text-xs space-y-2 list-decimal list-inside" style={{ color: 'var(--text-secondary)' }}>
                {position.method.map((step) => (
                  <li key={step} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- openings ---

function OpeningPanel(): React.JSX.Element {
  const [openings, setOpenings] = useState<OpeningSummary[] | null>(null)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<OpeningSummary | null>(null)

  useEffect(() => {
    void window.chess.puzzles.openings().then(setOpenings)
  }, [])

  const shown = useMemo(() => {
    if (!openings) return []
    const needle = filter.trim().toLowerCase()
    // Families first: a bare "Sicilian Defense" is what most people want, and
    // 1,589 variations is unusable without the filter.
    const pool = needle
      ? openings.filter((o) => o.name.toLowerCase().includes(needle))
      : openings.filter((o) => o.isFamily)
    return pool.slice(0, 60)
  }, [openings, filter])

  if (chosen) {
    return (
      <PuzzleRun
        title={chosen.name}
        subtitle={`${chosen.count.toLocaleString()} puzzles from real games in this opening.`}
        query={{ opening: chosen.id }}
        onBack={() => setChosen(null)}
      />
    )
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Opening tactics"
        subtitle="Train the positions your own repertoire actually produces."
      />

      <div className="card p-3 mb-4 flex items-center gap-2">
        <Search size={16} style={{ color: 'var(--text-muted)' }} />
        <input
          className="input flex-1"
          placeholder="Search 1,589 openings — try Najdorf, London, Ruy…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button className="btn btn-ghost" onClick={() => setFilter('')}>
            <X size={14} />
          </button>
        )}
      </div>

      {!openings ? (
        <div className="grid place-items-center p-8">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((opening) => (
            <button
              key={opening.id}
              onClick={() => setChosen(opening)}
              className="card p-3 text-left transition-colors hover:brightness-110"
            >
              <div className="text-sm font-semibold">{opening.name}</div>
              <div className="text-xs mt-1 tabular" style={{ color: 'var(--text-muted)' }}>
                {opening.count.toLocaleString()} puzzles
                {!opening.isFamily && ` · ${opening.family}`}
              </div>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Nothing matched “{filter}”.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- middlegame ---

function MiddlegamePanel(): React.JSX.Element {
  const [chosen, setChosen] = useState<StudySet | null>(null)

  if (chosen) {
    return (
      <PuzzleRun
        title={chosen.title}
        subtitle={chosen.blurb}
        query={chosen.query}
        onBack={() => setChosen(null)}
      />
    )
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Middlegame studies"
        subtitle="One shape at a time, rather than whatever comes next."
      />
      {MIDDLEGAME_GROUPS.map((group) => (
        <div key={group.id} className="mb-5">
          <div className="font-semibold mb-1">{group.title}</div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {group.blurb}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.sets.map((set) => (
              <button
                key={set.id}
                onClick={() => setChosen(set)}
                className="card p-3 text-left transition-colors hover:brightness-110"
              >
                <div className="text-sm font-semibold">{set.title}</div>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {set.blurb}
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------- shared puzzle sequence ---

/**
 * Solve an endless stream of puzzles matching a query, at the player's level.
 * Used by both the opening and middlegame panels; the only difference between
 * them is the query.
 */
function PuzzleRun({
  title,
  subtitle,
  query,
  onBack
}: {
  title: string
  subtitle: string
  query: Omit<PuzzleQuery, 'limit' | 'seed' | 'minRating' | 'maxRating'>
  onBack: () => void
}): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const rating = profile?.puzzleRating.rating ?? 1200

  const [queue, setQueue] = useState<Puzzle[]>([])
  const [index, setIndex] = useState(0)
  const [session, setSession] = useState({ solved: 0, total: 0 })
  const [hintRequest, setHintRequest] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const found = await window.chess.puzzles.find({
        ...query,
        minRating: Math.max(400, rating - BAND),
        maxRating: rating + BAND,
        limit: 10
      })
      if (found.length === 0) {
        setError('No puzzles at your rating for this set. It may be too narrow.')
      }
      setQueue(found)
      setIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating, JSON.stringify(query)])

  useEffect(() => {
    void load()
  }, [load])

  const puzzle = queue[index] ?? null

  const onComplete = useCallback(
    async (result: PuzzleResult) => {
      if (!puzzle) return
      setSession((s) => ({ solved: s.solved + (result.solved ? 1 : 0), total: s.total + 1 }))
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
    [puzzle, refreshProfile]
  )

  const next = (): void => {
    if (index + 1 < queue.length) setIndex((i) => i + 1)
    else void load()
  }

  return (
    <div>
      <button className="btn btn-ghost mb-4" onClick={onBack}>
        <ArrowLeft size={15} /> Back
      </button>
      <PageHeader title={title} subtitle={subtitle} />

      {error ? (
        <div className="card p-5 max-w-lg text-sm" style={{ color: 'var(--color-danger-400)' }}>
          {error}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
          <div>
            {loading || !puzzle ? (
              <div className="grid place-items-center" style={{ width: 360, height: 360 }}>
                <Spinner />
              </div>
            ) : (
              <PuzzleSolver
                key={puzzle.id}
                puzzle={puzzle}
                onComplete={(r) => void onComplete(r)}
                hintRequest={hintRequest}
              />
            )}
          </div>

          <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
            <div className="card p-4 mb-3">
              <div className="label mb-2">This session</div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <Stat label="Solved" value={`${session.solved} / ${session.total}`} />
                <Stat label="Rating" value={String(rating)} />
              </div>
              {puzzle && (
                <div className="text-xs mt-3 tabular" style={{ color: 'var(--text-muted)' }}>
                  Puzzle rated {puzzle.rating}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                className="btn flex-1"
                onClick={() => setHintRequest((n) => n + 1)}
                disabled={!puzzle}
              >
                <Lightbulb size={15} /> Hint
              </button>
              <button className="btn flex-1" onClick={next} disabled={loading}>
                <Target size={15} /> Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
