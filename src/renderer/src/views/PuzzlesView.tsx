import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Lightbulb,
  Eye,
  SlidersHorizontal,
  X,
  ExternalLink,
  Undo2,
  RotateCcw
} from 'lucide-react'
import type { Puzzle, PuzzleStats } from '@shared/types'
import PuzzleSolver, {
  puzzlePlayerColor,
  solutionSan,
  MAX_HINT_LEVEL,
  SQUARE_HINT_LEVEL,
  type PuzzleResult
} from '../components/PuzzleSolver'
import { PageHeader, Empty, Spinner } from '../components/ui'
import { useBoardSize, useStore } from '../state/useStore'
import {
  HIDDEN_THEMES,
  THEME_CATEGORIES,
  puzzleBrief,
  themeMeta,
  themesInCategory
} from '../data/puzzleThemes'

type Mode = 'rated' | 'custom'

/** How far either side of the player's rating a "rated" puzzle may sit. */
const RATED_BAND = 120

export default function PuzzlesView(): React.JSX.Element {
  const boardSize = useBoardSize()
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const puzzlesAvailable = useStore((s) => s.puzzlesAvailable)
  const puzzleError = useStore((s) => s.puzzleError)

  const [mode, setMode] = useState<Mode>('rated')
  const [themes, setThemes] = useState<string[]>([])
  const [range, setRange] = useState<[number, number]>([800, 1600])
  const [showFilters, setShowFilters] = useState(false)

  const [queue, setQueue] = useState<Puzzle[]>([])
  const [current, setCurrent] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<PuzzleStats | null>(null)

  const [outcome, setOutcome] = useState<PuzzleResult | null>(null)
  // A mistake no longer ends the puzzle, so "finished" is tracked separately
  // from "scored": the attempt is rated on the first mistake, but the position
  // stays playable until it is solved or the solution is revealed.
  const [progress, setProgress] = useState({ mistakes: 0, solved: false, canRewind: false })
  const [revealed, setRevealed] = useState(false)
  const [hintRequest, setHintRequest] = useState(0)
  const [revealRequest, setRevealRequest] = useState(0)
  const [rewindRequest, setRewindRequest] = useState(0)
  const [restartRequest, setRestartRequest] = useState(0)
  const [ratingDelta, setRatingDelta] = useState<number | null>(null)
  const [session, setSession] = useState({ solved: 0, attempted: 0 })

  const playerRating = profile?.puzzleRating.rating ?? 1200

  useEffect(() => {
    if (!puzzlesAvailable) return
    void window.chess.puzzles.stats().then(setStats)
  }, [puzzlesAvailable])

  /** Refill the queue, keeping a few puzzles ready so there is no wait. */
  const fetchBatch = useCallback(async (): Promise<Puzzle[]> => {
    const query =
      mode === 'rated'
        ? { minRating: playerRating - RATED_BAND, maxRating: playerRating + RATED_BAND, limit: 8 }
        : {
            minRating: range[0],
            maxRating: range[1],
            themes: themes.length > 0 ? themes : undefined,
            limit: 8
          }
    return window.chess.puzzles.find(query)
  }, [mode, playerRating, range, themes])

  const loadNext = useCallback(async () => {
    setOutcome(null)
    setProgress({ mistakes: 0, solved: false, canRewind: false })
    setRevealed(false)
    setHintRequest(0)
    setRevealRequest(0)
    setRewindRequest(0)
    setRestartRequest(0)
    setRatingDelta(null)

    if (queue.length > 0) {
      const [next, ...rest] = queue
      setCurrent(next)
      setQueue(rest)
      // Top up in the background once the queue runs low.
      if (rest.length <= 2) void fetchBatch().then((more) => setQueue((q) => [...q, ...more]))
      return
    }

    setLoading(true)
    try {
      const batch = await fetchBatch()
      const [next, ...rest] = batch
      setCurrent(next ?? null)
      setQueue(rest)
    } finally {
      setLoading(false)
    }
  }, [queue, fetchBatch])

  // Start over whenever the filters change.
  useEffect(() => {
    if (!puzzlesAvailable) return
    setQueue([])
    setCurrent(null)
    setOutcome(null)
    setProgress({ mistakes: 0, solved: false, canRewind: false })
    setRevealed(false)
    setLoading(true)
    void fetchBatch()
      .then((batch) => {
        const [next, ...rest] = batch
        setCurrent(next ?? null)
        setQueue(rest)
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, themes, range[0], range[1], puzzlesAvailable])

  /**
   * Play the current puzzle again from the start.
   *
   * The result is already recorded, so this clears only the presentation —
   * the rating change and session tally stay as they were.
   */
  const replayPuzzle = useCallback(() => {
    setRevealed(false)
    setOutcome(null)
    setRatingDelta(null)
    setHintRequest(0)
    setRestartRequest((n) => n + 1)
  }, [])

  const onComplete = useCallback(
    async (result: PuzzleResult) => {
      if (!current) return
      setOutcome(result)

      // A replay is practice: showing how it went is useful, changing the
      // rating a second time for the same puzzle is not.
      if (result.replay) return

      setSession((s) => ({ solved: s.solved + (result.solved ? 1 : 0), attempted: s.attempted + 1 }))

      const before = playerRating
      const attempt = await window.chess.profile.recordPuzzleAttempt({
        puzzleId: current.id,
        puzzleRating: current.rating,
        puzzleRd: current.ratingDeviation,
        themes: current.themes,
        solved: result.solved,
        ms: result.ms,
        hints: result.hints
      })
      setRatingDelta(attempt.ratingAfter - before)
      await refreshProfile()
    },
    [current, playerRating, refreshProfile]
  )

  const toggleTheme = (id: string): void => {
    setMode('custom')
    setThemes((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]))
  }

  if (!puzzlesAvailable) {
    return (
      <div className="p-8">
        <PageHeader title="Puzzles" />
        <Empty
          title="Puzzle database not found"
          message={
            puzzleError ??
            'The puzzle database has not been built yet. Run "npm run puzzles:build" to import it.'
          }
        />
      </div>
    )
  }

  const solution = current ? solutionSan(current) : []
  // Scored on the first mistake, but not over until solved or given up.
  const finished = progress.solved || revealed
  // Derived from the puzzle's own theme tags, so the hint describes this
  // position rather than offering generic encouragement.
  const brief = current
    ? puzzleBrief(current.themes, current.moves.length)
    : { goal: '', length: '', motif: '' }

  return (
    <div className="p-3 sm:p-6">
      <PageHeader
        title="Puzzles"
        subtitle={
          stats
            ? `${stats.total.toLocaleString()} positions, rated ${stats.minRating} to ${stats.maxRating}.`
            : 'Loading the database…'
        }
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              {(['rated', 'custom'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="px-3 py-1.5 text-sm transition-colors"
                  style={{
                    background: mode === m ? 'var(--surface-3)' : 'transparent',
                    fontWeight: mode === m ? 600 : 400
                  }}
                >
                  {m === 'rated' ? 'Rated' : 'Custom'}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal size={15} /> Filters
            </button>
          </>
        }
      />

      {showFilters && (
        <FilterPanel
          range={range}
          setRange={(r) => {
            setMode('custom')
            setRange(r)
          }}
          themes={themes}
          toggleTheme={toggleTheme}
          clearThemes={() => setThemes([])}
          stats={stats}
          onClose={() => setShowFilters(false)}
        />
      )}

      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div>
          {loading || !current ? (
            <div
              className="card grid place-items-center"
              style={{ width: boardSize, height: boardSize }}
            >
              {loading ? <Spinner size={22} /> : <span className="text-sm">No puzzles match these filters.</span>}
            </div>
          ) : (
            <PuzzleSolver
              key={current.id}
              puzzle={current}
              onComplete={onComplete}
              onProgress={setProgress}
              hintRequest={hintRequest}
              revealRequest={revealRequest}
              rewindRequest={rewindRequest}
              restartRequest={restartRequest}
            />
          )}
        </div>

        <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
          {current && (
            <>
              <div className="card p-4 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="label">Puzzle</span>
                  <span className="chip tabular">{current.rating}</span>
                </div>

                {!finished && (
                  <>
                    <p className="text-sm">
                      <span className="font-semibold">
                        {puzzlePlayerColor(current) === 'w' ? 'White' : 'Black'} to move.
                      </span>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>{brief.goal}</span>
                    </p>
                    {brief.length && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {brief.length}
                      </p>
                    )}
                    {progress.mistakes > 0 && (
                      <p className="text-xs mt-2" style={{ color: 'var(--color-warn-400)' }}>
                        Not quite — the move was taken back. Try again; the puzzle is still yours to finish.
                      </p>
                    )}
                  </>
                )}

                {finished && (
                  <div>
                    <div
                      className="font-semibold"
                      style={{
                        color: progress.solved
                          ? progress.mistakes === 0
                            ? 'var(--color-accent-400)'
                            : 'var(--color-warn-400)'
                          : 'var(--color-danger-400)'
                      }}
                    >
                      {progress.solved
                        ? progress.mistakes === 0
                          ? 'Solved'
                          : `Solved after ${progress.mistakes} ${progress.mistakes === 1 ? 'mistake' : 'mistakes'}`
                        : 'Solution shown'}
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <span>{((outcome?.ms ?? 0) / 1000).toFixed(1)}s</span>
                      {(outcome?.hints ?? 0) > 0 && (
                        <span>· {outcome?.hints} hint{(outcome?.hints ?? 0) > 1 ? 's' : ''}</span>
                      )}
                      {ratingDelta != null && (
                        <span
                          className="tabular font-semibold"
                          style={{
                            color: ratingDelta >= 0 ? 'var(--color-accent-400)' : 'var(--color-danger-400)'
                          }}
                        >
                          {ratingDelta >= 0 ? '+' : ''}
                          {ratingDelta}
                        </span>
                      )}
                    </div>
                    {solution.length > 0 && (
                      <div className="mt-3">
                        <div className="label mb-1">Solution</div>
                        <div className="text-sm font-mono selectable">{solution.join('  ')}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>


              {hintRequest > 0 && !finished && (
                <div className="card p-4 mb-3" style={{ borderColor: 'var(--color-info-500)' }}>
                  <div className="label mb-2 flex items-center gap-1.5">
                    <Lightbulb size={13} /> Hint {Math.min(hintRequest, MAX_HINT_LEVEL)} of {MAX_HINT_LEVEL}
                  </div>
                  <p className="text-sm" style={{ color: 'var(--color-info-400)' }}>{brief.motif}</p>
                  {hintRequest >= SQUARE_HINT_LEVEL && (
                    <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                      {hintRequest > SQUARE_HINT_LEVEL
                        ? 'The move is marked on the board.'
                        : 'The piece to move is marked on the board.'}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  className="btn"
                  onClick={() => setHintRequest((n) => Math.min(n + 1, MAX_HINT_LEVEL))}
                  disabled={finished || hintRequest >= MAX_HINT_LEVEL}
                  title="Each press reveals a little more, starting with what the puzzle is about"
                >
                  <Lightbulb size={15} /> {hintRequest === 0 ? 'Hint' : `Hint ${hintRequest}/${MAX_HINT_LEVEL}`}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setRevealed(true)
                    setRevealRequest((n) => n + 1)
                  }}
                  disabled={finished}
                >
                  <Eye size={15} /> Solution
                </button>

                <button
                  className="btn"
                  onClick={() => setRewindRequest((n) => n + 1)}
                  disabled={finished || !progress.canRewind}
                  title="Step back one move so you can try a different continuation"
                >
                  <Undo2 size={15} /> Rewind
                </button>
                <button
                  className="btn"
                  onClick={replayPuzzle}
                  title={
                    finished
                      ? 'Play this puzzle again. Your recorded result will not change.'
                      : 'Back to the start of this puzzle'
                  }
                >
                  <RotateCcw size={15} /> {finished ? 'Try again' : 'Restart'}
                </button>

                <button className="btn btn-primary col-span-2" onClick={loadNext}>
                  Next puzzle <ChevronRight size={15} />
                </button>
              </div>

              {finished && current.themes.length > 0 && (
                <div className="card p-4 mb-3">
                  <div className="label mb-2">Themes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {current.themes
                      .filter((t) => !HIDDEN_THEMES.has(t))
                      .map((t) => {
                        const meta = themeMeta(t)
                        return (
                          <button
                            key={t}
                            className="chip"
                            title={meta.description}
                            onClick={() => {
                              setThemes([t])
                              setMode('custom')
                            }}
                          >
                            {meta.name}
                          </button>
                        )
                      })}
                  </div>
                  {current.gameUrl && (
                    <button
                      className="btn btn-ghost w-full mt-3 text-xs"
                      onClick={() => void window.chess.app.openExternal(current.gameUrl)}
                    >
                      <ExternalLink size={13} /> View the original game
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <div className="card p-4">
            <div className="label mb-2">This session</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular">{session.solved}</span>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                / {session.attempted} solved
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Your rating</span>
              <span className="tabular font-semibold">{playerRating}</span>
            </div>
            {mode === 'rated' && (
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                Serving puzzles rated {playerRating - RATED_BAND}–{playerRating + RATED_BAND}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterPanel({
  range,
  setRange,
  themes,
  toggleTheme,
  clearThemes,
  stats,
  onClose
}: {
  range: [number, number]
  setRange: (range: [number, number]) => void
  themes: string[]
  toggleTheme: (id: string) => void
  clearThemes: () => void
  stats: PuzzleStats | null
  onClose: () => void
}): React.JSX.Element {
  const counts = useMemo(() => new Map(stats?.themes.map((t) => [t.theme, t.count]) ?? []), [stats])

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <span className="font-semibold text-sm">Filters</span>
        <div className="flex items-center gap-2">
          {themes.length > 0 && (
            <button className="btn btn-ghost text-xs" onClick={clearThemes}>
              Clear {themes.length} theme{themes.length > 1 ? 's' : ''}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close filters">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="label">Rating range</span>
          <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
            {range[0]} – {range[1]}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={400}
            max={3000}
            step={50}
            value={range[0]}
            onChange={(e) => setRange([Math.min(Number(e.target.value), range[1] - 50), range[1]])}
            className="flex-1"
            style={{ accentColor: 'var(--color-accent-500)' }}
            aria-label="Minimum rating"
          />
          <input
            type="range"
            min={400}
            max={3000}
            step={50}
            value={range[1]}
            onChange={(e) => setRange([range[0], Math.max(Number(e.target.value), range[0] + 50)])}
            className="flex-1"
            style={{ accentColor: 'var(--color-accent-500)' }}
            aria-label="Maximum rating"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
        {THEME_CATEGORIES.map((category) => (
          <div key={category.id}>
            <div className="label mb-2">{category.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {themesInCategory(category.id).map((theme) => {
                const active = themes.includes(theme.id)
                const count = counts.get(theme.id)
                return (
                  <button
                    key={theme.id}
                    className="chip"
                    onClick={() => toggleTheme(theme.id)}
                    title={`${theme.description}${count ? ` — ${count.toLocaleString()} puzzles` : ''}`}
                    style={
                      active
                        ? {
                            background: 'var(--color-accent-500)',
                            borderColor: 'var(--color-accent-500)',
                            color: 'oklch(0.18 0.02 155)'
                          }
                        : undefined
                    }
                  >
                    {theme.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
