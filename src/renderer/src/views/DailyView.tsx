import { useCallback, useEffect, useMemo, useState } from 'react'
import { Flame, Check, Lightbulb, Eye, CalendarDays, Undo2, RotateCcw } from 'lucide-react'
import type { Puzzle } from '@shared/types'
import PuzzleSolver, {
  puzzlePlayerColor,
  solutionSan,
  MAX_HINT_LEVEL,
  SQUARE_HINT_LEVEL,
  type PuzzleResult
} from '../components/PuzzleSolver'
import { PageHeader, Empty, Spinner, Stat } from '../components/ui'
import { useBoardSize, useStore } from '../state/useStore'
import { themeMeta, puzzleBrief } from '../data/puzzleThemes'
import { HIDDEN_THEMES } from '../data/puzzleThemes'

/** Local calendar date as YYYY-MM-DD — never UTC, or the day flips early. */
function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DailyView(): React.JSX.Element {
  const boardSize = useBoardSize()
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const puzzlesAvailable = useStore((s) => s.puzzlesAvailable)

  const today = localDate()
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(true)
  const [outcome, setOutcome] = useState<PuzzleResult | null>(null)
  // Scored on the first mistake, but playable until solved or given up.
  const [progress, setProgress] = useState({ mistakes: 0, solved: false, canRewind: false })
  const [revealed, setRevealed] = useState(false)
  const [hintRequest, setHintRequest] = useState(0)
  const [revealRequest, setRevealRequest] = useState(0)
  const [rewindRequest, setRewindRequest] = useState(0)
  const [restartRequest, setRestartRequest] = useState(0)

  const alreadyDone = profile?.daily[today]

  useEffect(() => {
    if (!puzzlesAvailable) {
      setLoading(false)
      return
    }
    void window.chess.puzzles
      .daily(today)
      .then(setPuzzle)
      .finally(() => setLoading(false))
  }, [today, puzzlesAvailable])

  const onComplete = useCallback(
    async (result: PuzzleResult) => {
      if (!puzzle) return
      setOutcome(result)

      // Only the first attempt of the day counts toward the streak.
      if (!alreadyDone) {
        await window.chess.profile.recordDaily({
          date: today,
          puzzleId: puzzle.id,
          solved: result.solved,
          ms: result.ms,
          hints: result.hints
        })
        await window.chess.profile.recordPuzzleAttempt({
          puzzleId: puzzle.id,
          puzzleRating: puzzle.rating,
          puzzleRd: puzzle.ratingDeviation,
          themes: puzzle.themes,
          solved: result.solved,
          ms: result.ms,
          hints: result.hints
        })
      }
      await refreshProfile()
    },
    [puzzle, today, alreadyDone, refreshProfile]
  )

  /** The last fourteen days, for the streak strip. */
  const recentDays = useMemo(() => {
    const days: { date: string; solved: boolean | null }[] = []
    for (let i = 13; i >= 0; i--) {
      const date = localDate(new Date(Date.now() - i * 86_400_000))
      const record = profile?.daily[date]
      days.push({ date, solved: record ? record.solved : null })
    }
    return days
  }, [profile])

  if (!puzzlesAvailable) {
    return (
      <div className="p-8">
        <PageHeader title="Daily puzzle" />
        <Empty
          title="Puzzle database not found"
          message='Run "npm run puzzles:build" to import the puzzle database.'
        />
      </div>
    )
  }

  const solution = puzzle ? solutionSan(puzzle) : []
  const finished = progress.solved || revealed
  const brief = puzzle
    ? puzzleBrief(puzzle.themes, puzzle.moves.length)
    : { goal: '', length: '', motif: '' }
  const streak = profile?.streak

  return (
    <div className="p-3 sm:p-6">
      <PageHeader
        title="Daily puzzle"
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })}
      />

      <div className="grid grid-cols-3 gap-3 mb-6 max-w-3xl">
        <Stat
          label="Current streak"
          value={streak?.current ?? 0}
          sub={streak?.current === 1 ? 'day' : 'days'}
          tone={streak && streak.current > 0 ? 'warn' : 'default'}
        />
        <Stat label="Longest streak" value={streak?.longest ?? 0} sub="days" />
        <Stat label="Total solved" value={Object.values(profile?.daily ?? {}).filter((d) => d.solved).length} />
      </div>

      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div>
          {loading || !puzzle ? (
            <div
              className="card grid place-items-center"
              style={{ width: boardSize, height: boardSize }}
            >
              {loading ? <Spinner size={22} /> : <span className="text-sm">No puzzle available.</span>}
            </div>
          ) : (
            <PuzzleSolver
              key={puzzle.id}
              puzzle={puzzle}
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
          {alreadyDone && !finished && progress.mistakes === 0 && (
            <div className="card p-4 mb-3" style={{ borderColor: 'var(--color-accent-500)' }}>
              <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--color-accent-400)' }}>
                <Check size={16} /> Already played today
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                You {alreadyDone.solved ? 'solved' : 'missed'} today&apos;s puzzle. Play it again for practice —
                it will not change your streak.
              </p>
            </div>
          )}

          {puzzle && (
            <div className="card p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="label">Today&apos;s puzzle</span>
                <span className="chip tabular">{puzzle.rating}</span>
              </div>

              {!finished ? (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">
                      {puzzlePlayerColor(puzzle) === 'w' ? 'White' : 'Black'} to move.
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
                      Not quite — the move was taken back. Today&apos;s result is already recorded, but you
                      can still work it out.
                    </p>
                  )}
                </>
              ) : (
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
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {((outcome?.ms ?? 0) / 1000).toFixed(1)}s
                    {(outcome?.hints ?? 0) > 0 &&
                      ` · ${outcome?.hints} hint${(outcome?.hints ?? 0) > 1 ? 's' : ''}`}
                  </div>
                  {solution.length > 0 && (
                    <div className="mt-3">
                      <div className="label mb-1">Solution</div>
                      <div className="text-sm font-mono selectable">{solution.join('  ')}</div>
                    </div>
                  )}
                  {puzzle.themes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {puzzle.themes
                        .filter((t) => !HIDDEN_THEMES.has(t))
                        .map((t) => (
                          <span key={t} className="chip" title={themeMeta(t).description}>
                            {themeMeta(t).name}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


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

          {!finished && puzzle && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                className="btn"
                onClick={() => setHintRequest((n) => Math.min(n + 1, MAX_HINT_LEVEL))}
                disabled={hintRequest >= MAX_HINT_LEVEL}
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
              >
                <Eye size={15} /> Solution
              </button>
              <button
                className="btn"
                onClick={() => setRewindRequest((n) => n + 1)}
                disabled={!progress.canRewind}
                title="Step back one move so you can try a different continuation"
              >
                <Undo2 size={15} /> Rewind
              </button>
              <button
                className="btn"
                onClick={() => setRestartRequest((n) => n + 1)}
                title="Back to the start of today's puzzle"
              >
                <RotateCcw size={15} /> Restart
              </button>
            </div>
          )}

          <div className="card p-4">
            <div className="label mb-3 flex items-center gap-1.5">
              <CalendarDays size={13} /> Last two weeks
            </div>
            <div className="flex gap-1">
              {recentDays.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${
                    day.solved === null ? 'not played' : day.solved ? 'solved' : 'missed'
                  }`}
                  className="flex-1 rounded"
                  style={{
                    height: 26,
                    background:
                      day.solved === null
                        ? 'var(--surface-3)'
                        : day.solved
                          ? 'var(--color-accent-500)'
                          : 'var(--color-danger-500)',
                    opacity: day.solved === null ? 0.5 : 1
                  }}
                />
              ))}
            </div>
            {streak && streak.current > 2 && (
              <div
                className="flex items-center gap-1.5 mt-3 text-xs font-semibold"
                style={{ color: 'var(--color-warn-400)' }}
              >
                <Flame size={13} /> {streak.current} days in a row
              </div>
            )}
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            The daily puzzle is chosen from the date alone, so it is the same on every machine and cannot be
            rerolled.
          </p>
        </div>
      </div>
    </div>
  )
}
