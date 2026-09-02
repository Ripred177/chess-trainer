import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Flag, RotateCcw, Undo2, Lightbulb, RefreshCw, ChevronLeft, Timer } from 'lucide-react'
import type { Color, TimeControl } from '@shared/types'
import Board from '../components/Board'
import EvalBar from '../components/EvalBar'
import MoveList from '../components/MoveList'
import Clock from '../components/Clock'
import { PageHeader } from '../components/ui'
import { BOTS, TIER_LABELS, TIER_ORDER, suggestBot, type Bot } from '../data/bots'
import {
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  customTimeControl,
  getTimeControl,
  inCategory
} from '../data/timeControls'
import { useBoardColors, useBoardSize, usePieceColors, useSettings, useStore } from '../state/useStore'
import { configureSound, play, playMoveSound } from '../lib/sound'
import { hasMatingMaterial, useClock } from '../lib/useClock'
import {
  START_FEN,
  materialBalance,
  outcomeOf,
  parseUci,
  toWhitePov,
  type PieceType,
  type Square
} from '../lib/chess'
import { usePieceResolver } from '../lib/pieceSprites'

type Phase = 'setup' | 'playing' | 'over'

interface GameEnd {
  result: '1-0' | '0-1' | '1/2-1/2'
  termination: string
  playerWon: boolean | null
}

export default function PlayView(): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const profile = useStore((s) => s.profile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const updateSettings = useStore((s) => s.updateSettings)

  const [phase, setPhase] = useState<Phase>('setup')
  const [bot, setBot] = useState<Bot>(() => suggestBot(profile?.playRating.rating ?? 1200))
  const [playerColor, setPlayerColor] = useState<Color | 'random'>('w')
  const [actualColor, setActualColor] = useState<Color>('w')

  const [timeControl, setTimeControl] = useState<TimeControl>(() =>
    getTimeControl(profile?.settings.timeControlId ?? 'untimed')
  )
  const [customMinutes, setCustomMinutes] = useState(5)
  const [customIncrement, setCustomIncrement] = useState(3)

  // chess.js is mutable, so the instance lives in a ref and every render reads
  // from derived state that we bump explicitly after each move.
  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(START_FEN)
  const [history, setHistory] = useState<string[]>([])
  const [viewIndex, setViewIndex] = useState(-1)
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [gameEnd, setGameEnd] = useState<GameEnd | null>(null)
  const [hint, setHint] = useState<{ from: Square; to: Square } | null>(null)
  const [resignArmed, setResignArmed] = useState(false)
  const [evaluation, setEvaluation] = useState<{ cp: number | null; mate: number | null }>({
    cp: 0,
    mate: null
  })

  // Guards against a stale engine reply landing after a new game or a takeback.
  const generation = useRef(0)
  const timed = timeControl.initialMs > 0

  useEffect(() => {
    configureSound(settings.soundEnabled, settings.soundVolume)
  }, [settings.soundEnabled, settings.soundVolume])

  // ---------------------------------------------------------------- clock ---

  // The end-of-game handler needs the clock, and the clock's flag callback
  // needs the handler, so the callback reads through a ref.
  const onFlagRef = useRef<(color: Color) => void>(() => {})

  const clock = useClock(
    timeControl,
    (color) => onFlagRef.current(color),
    () => play('check'),
    settings.lowTimeWarningSec
  )

  /** Persist the finished game and update the ratings. */
  const finishGame = useCallback(
    async (end: GameEnd) => {
      clock.stop()

      // A game nobody moved in is an abort, not a result. Walking away from a
      // 2+1 board and letting it flag should not cost rating points, so it is
      // recorded with an unfinished result, which the rating code skips.
      const aborted = gameRef.current.history().length === 0
      const outcome: GameEnd = aborted
        ? { result: end.result, termination: 'Aborted before any moves', playerWon: null }
        : end

      setGameEnd(outcome)
      setPhase('over')
      play('end')

      const left = clock.read()
      await window.chess.profile.recordGame({
        playerColor: actualColor,
        opponentElo: bot.elo,
        result: aborted ? '*' : outcome.result,
        termination: outcome.termination,
        pgn: gameRef.current.pgn(),
        moveCount: gameRef.current.history().length,
        timeControl: {
          name: timeControl.name,
          category: timeControl.category,
          initialMs: timeControl.initialMs,
          incrementMs: timeControl.incrementMs
        },
        ...(timed ? { clockLeft: { w: Math.round(left.w), b: Math.round(left.b) } } : {})
      })
      await refreshProfile()
    },
    [actualColor, bot.elo, refreshProfile, clock, timeControl, timed]
  )

  /**
   * Running out of time only loses if the opponent could actually mate. With a
   * lone king or a single minor piece they cannot, and the game is drawn.
   */
  onFlagRef.current = useCallback(
    (color: Color) => {
      const opponent: Color = color === 'w' ? 'b' : 'w'
      const canMate = hasMatingMaterial(gameRef.current.fen(), opponent)

      if (!canMate) {
        void finishGame({
          result: '1/2-1/2',
          termination: 'Timeout vs insufficient material',
          playerWon: null
        })
        return
      }

      void finishGame({
        result: opponent === 'w' ? '1-0' : '0-1',
        termination: `${color === 'w' ? 'White' : 'Black'} ran out of time`,
        playerWon: opponent === actualColor
      })
    },
    [finishGame, actualColor]
  )

  // ----------------------------------------------------------------- game ---

  const startGame = useCallback(() => {
    const color: Color = playerColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : playerColor
    generation.current++
    gameRef.current = new Chess()
    setActualColor(color)
    setFen(gameRef.current.fen())
    setHistory([])
    setViewIndex(-1)
    setLastMove(null)
    setGameEnd(null)
    setHint(null)
    setEvaluation({ cp: 0, mate: null })
    setPhase('playing')

    clock.reset()
    // White's clock runs from the first move, as it does over the board.
    clock.start('w')
    void updateSettings({ timeControlId: timeControl.id })
  }, [playerColor, clock, timeControl.id, updateSettings])

  const checkGameOver = useCallback((): boolean => {
    const outcome = outcomeOf(gameRef.current)
    if (!outcome.over) return false
    void finishGame({
      result: outcome.result as GameEnd['result'],
      termination: outcome.termination,
      playerWon: outcome.winner == null ? null : outcome.winner === actualColor
    })
    return true
  }, [actualColor, finishGame])

  /** Ask the engine for its reply and play it. */
  const engineMove = useCallback(async () => {
    const myGeneration = generation.current
    const engineColor: Color = actualColor === 'w' ? 'b' : 'w'
    setThinking(true)
    try {
      // Read the clock synchronously so the engine budgets against the time it
      // genuinely has left, not the last rendered value.
      const left = timed ? clock.read() : null

      const result = await window.chess.engine.go({
        fen: START_FEN,
        moves: gameRef.current.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`),
        strength: { elo: bot.elo, moveTimeMs: bot.moveTimeMs },
        ...(left
          ? {
              clock: {
                wtime: Math.max(1, left.w),
                btime: Math.max(1, left.b),
                winc: timeControl.incrementMs,
                binc: timeControl.incrementMs
              }
            }
          : {})
      })

      // A new game, takeback, or flag happened while the engine was thinking.
      if (myGeneration !== generation.current) return
      if (!result.bestmove) return
      if (gameRef.current.isGameOver()) return

      const parsed = parseUci(result.bestmove)
      if (!parsed) return

      const move = gameRef.current.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion ?? 'q'
      })
      if (!move) return

      clock.press(engineColor)
      setFen(gameRef.current.fen())
      setHistory(gameRef.current.history())
      setViewIndex(gameRef.current.history().length - 1)
      setLastMove({ from: parsed.from, to: parsed.to })
      playMoveSound({
        captured: Boolean(move.captured),
        check: gameRef.current.inCheck(),
        castle: move.san.startsWith('O-O'),
        promotion: Boolean(move.promotion)
      })

      if (result.info?.lines[0]) {
        const line = result.info.lines[0]
        setEvaluation(toWhitePov(line.cp, line.mate, gameRef.current.turn() === 'w' ? 'b' : 'w'))
      }

      checkGameOver()
    } finally {
      if (myGeneration === generation.current) setThinking(false)
    }
  }, [bot.elo, bot.moveTimeMs, checkGameOver, clock, actualColor, timed, timeControl.incrementMs])

  // Drive the engine whenever it is its turn.
  useEffect(() => {
    if (phase !== 'playing') return
    if (gameRef.current.turn() === actualColor) return
    if (gameRef.current.isGameOver()) return
    if (thinking) return
    void engineMove()
    // `fen` is the trigger: it changes exactly once per move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, phase, actualColor])

  const onPlayerMove = useCallback(
    (from: Square, to: Square, promotion?: PieceType) => {
      if (phase !== 'playing') return
      if (gameRef.current.turn() !== actualColor) return

      const move = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) return

      clock.press(actualColor)
      setHint(null)
      setFen(gameRef.current.fen())
      setHistory(gameRef.current.history())
      setViewIndex(gameRef.current.history().length - 1)
      setLastMove({ from, to })
      playMoveSound({
        captured: Boolean(move.captured),
        check: gameRef.current.inCheck(),
        castle: move.san.startsWith('O-O'),
        promotion: Boolean(move.promotion)
      })
      checkGameOver()
    },
    [phase, actualColor, checkGameOver, clock]
  )

  /** Undo the player's last move and the engine's reply together. */
  const takeback = useCallback(() => {
    if (phase !== 'playing') return
    generation.current++
    setThinking(false)
    gameRef.current.undo()
    if (gameRef.current.turn() !== actualColor) gameRef.current.undo()
    const moves = gameRef.current.history({ verbose: true })
    const previous = moves.at(-1)
    setFen(gameRef.current.fen())
    setHistory(gameRef.current.history())
    setViewIndex(gameRef.current.history().length - 1)
    setLastMove(previous ? { from: previous.from as Square, to: previous.to as Square } : null)
    setHint(null)
  }, [phase, actualColor])

  const requestHint = useCallback(async () => {
    if (phase !== 'playing' || gameRef.current.turn() !== actualColor) return
    const result = await window.chess.engine.evaluate({
      fen: gameRef.current.fen(),
      depth: 14
    })
    if (!result.bestmove) return
    const parsed = parseUci(result.bestmove)
    if (parsed) setHint({ from: parsed.from, to: parsed.to })
  }, [phase, actualColor])

  /**
   * Resigning takes two deliberate clicks.
   *
   * This used to raise a native `window.confirm`, which grabs focus and accepts
   * on a stray Enter — easy to trigger by accident mid-game. An in-place
   * confirmation stays inside the app, can't be dismissed by the keyboard, and
   * reverts on its own if it was a misclick.
   */
  const resignArmedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doResign = useCallback(() => {
    setResignArmed(false)
    void finishGame({
      result: actualColor === 'w' ? '0-1' : '1-0',
      termination: 'Resignation',
      playerWon: false
    })
  }, [actualColor, finishGame])

  const resign = useCallback(() => {
    if (!settings.confirmResign) {
      doResign()
      return
    }
    if (resignArmed) {
      if (resignArmedTimer.current) clearTimeout(resignArmedTimer.current)
      doResign()
      return
    }
    setResignArmed(true)
    resignArmedTimer.current = setTimeout(() => setResignArmed(false), 4000)
  }, [settings.confirmResign, resignArmed, doResign])

  // Never leave the button armed across games.
  useEffect(() => {
    if (phase !== 'playing') setResignArmed(false)
  }, [phase])

  // Stop the clock if the player leaves a game running.
  useEffect(() => () => clock.stop(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // The board shows a past position when browsing the move list.
  const displayFen = useMemo(() => {
    if (viewIndex >= history.length - 1) return fen
    const replay = new Chess()
    for (let i = 0; i <= viewIndex; i++) replay.move(history[i])
    return replay.fen()
  }, [viewIndex, history, fen])

  const browsing = viewIndex < history.length - 1
  const material = useMemo(() => materialBalance(displayFen), [displayFen])
  const opponentColor: Color = actualColor === 'w' ? 'b' : 'w'

  if (phase === 'setup') {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <PageHeader
          title="Play"
          subtitle="Pick a pace and an opponent. Every rating is a model trained on real players at that level, so the weaker bots make the mistakes people actually make."
        />

        <TimeControlPicker
          selected={timeControl}
          onSelect={setTimeControl}
          customMinutes={customMinutes}
          customIncrement={customIncrement}
          setCustomMinutes={setCustomMinutes}
          setCustomIncrement={setCustomIncrement}
        />

        <div className="card p-5 mb-4">
          <div className="label mb-3">Play as</div>
          <div className="flex gap-2">
            {(['w', 'random', 'b'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setPlayerColor(option)}
                className="btn flex-1"
                style={
                  playerColor === option
                    ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                    : undefined
                }
              >
                {option === 'w' ? 'White' : option === 'b' ? 'Black' : 'Random'}
              </button>
            ))}
          </div>
        </div>

        {TIER_ORDER.map((tier) => (
          <div key={tier} className="mb-5">
            <div className="label mb-2">{TIER_LABELS[tier]}</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {BOTS.filter((b) => b.tier === tier).map((option) => (
                <button
                  key={option.id}
                  onClick={() => setBot(option)}
                  className="card p-4 text-left transition-all"
                  style={{
                    borderColor: bot.id === option.id ? 'var(--color-accent-500)' : 'var(--border-subtle)',
                    background: bot.id === option.id ? 'var(--surface-2)' : 'var(--surface-1)'
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{option.name}</span>
                    <span className="chip tabular">{option.elo}</span>
                  </div>
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {option.blurb}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ))}

        <button className="btn btn-primary w-full py-3 text-base" onClick={startGame}>
          Play {bot.name} ({bot.elo}) · {timeControl.name}
        </button>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div>
          <PlayerStrip
            name={bot.name}
            rating={bot.elo}
            captured={actualColor === 'w' ? material.blackCaptured : material.whiteCaptured}
            advantage={actualColor === 'w' ? -material.advantage : material.advantage}
            pieceSet={settings.pieceSetId}
            color={opponentColor}
            thinking={thinking}
            clockMs={timed ? clock.times[opponentColor] : null}
            clockRunning={clock.active === opponentColor}
            clockIdle={phase === 'over'}
            lowTimeSec={settings.lowTimeWarningSec}
          />

          <div className="flex gap-2 my-2">
            {settings.showEvalBar && (
              <EvalBar
                cp={evaluation.cp}
                mate={evaluation.mate}
                height={boardSize}
                orientation={actualColor}
                loading={thinking}
              />
            )}
            <Board
              fen={displayFen}
              orientation={actualColor}
              movableFor={phase === 'playing' && !browsing ? actualColor : null}
              onMove={onPlayerMove}
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
              disabled={thinking || browsing}
              highlights={
                hint
                  ? { [hint.from]: 'rgba(90,160,240,0.5)', [hint.to]: 'rgba(90,160,240,0.5)' }
                  : undefined
              }
            />
          </div>

          <PlayerStrip
            name={profile?.displayName ?? 'You'}
            rating={profile?.playRating.rating ?? 1200}
            captured={actualColor === 'w' ? material.whiteCaptured : material.blackCaptured}
            advantage={actualColor === 'w' ? material.advantage : -material.advantage}
            pieceSet={settings.pieceSetId}
            color={actualColor}
            thinking={false}
            clockMs={timed ? clock.times[actualColor] : null}
            clockRunning={clock.active === actualColor}
            clockIdle={phase === 'over'}
            lowTimeSec={settings.lowTimeWarningSec}
          />
        </div>

        <div className="w-full max-w-[20rem] lg:w-80 shrink-0">
          <div className="card p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm">{bot.name}</span>
              <div className="flex items-center gap-1.5">
                <span className="chip">
                  <Timer size={11} /> {timeControl.name}
                </span>
                <span className="chip tabular">{bot.elo}</span>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {bot.blurb}
            </p>
          </div>

          {gameEnd && (
            <div
              className="card p-4 mb-3"
              style={{
                borderColor:
                  gameEnd.playerWon === true
                    ? 'var(--color-accent-500)'
                    : gameEnd.playerWon === false
                      ? 'var(--color-danger-500)'
                      : 'var(--border-strong)'
              }}
            >
              <div className="font-semibold">
                {gameEnd.termination.startsWith('Aborted')
                  ? 'Game aborted'
                  : gameEnd.playerWon === true
                    ? 'You won'
                    : gameEnd.playerWon === false
                      ? 'You lost'
                      : 'Draw'}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {gameEnd.termination}
                {gameEnd.termination.startsWith('Aborted') ? ' · not rated' : ` · ${gameEnd.result}`}
              </div>
              <button className="btn btn-primary w-full mt-3" onClick={startGame}>
                <RefreshCw size={15} /> Play again
              </button>
              <button className="btn w-full mt-2" onClick={() => setPhase('setup')}>
                <ChevronLeft size={15} /> Change opponent or pace
              </button>
            </div>
          )}

          <div className="card p-2 mb-3" style={{ maxHeight: 300, overflow: 'auto' }}>
            <MoveList
              moves={history}
              current={viewIndex}
              onSelect={setViewIndex}
              emptyMessage="The game starts here."
            />
          </div>

          {phase === 'playing' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn"
                onClick={takeback}
                disabled={history.length < 2 || thinking || timed}
                title={timed ? 'Takebacks are disabled in timed games' : 'Undo your last move'}
              >
                <Undo2 size={15} /> Takeback
              </button>
              <button
                className="btn"
                onClick={requestHint}
                disabled={thinking || gameRef.current.turn() !== actualColor}
              >
                <Lightbulb size={15} /> Hint
              </button>
              {resignArmed ? (
                <>
                  <button
                    className="btn"
                    onClick={() => setResignArmed(false)}
                    style={{ borderColor: 'var(--border-strong)' }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={resign}
                    style={{
                      background: 'color-mix(in oklch, var(--color-danger-500) 20%, transparent)',
                      borderColor: 'var(--color-danger-500)',
                      fontWeight: 600
                    }}
                  >
                    <Flag size={15} /> Confirm
                  </button>
                </>
              ) : (
                <button className="btn btn-danger col-span-2" onClick={resign}>
                  <Flag size={15} /> Resign
                </button>
              )}
            </div>
          )}

          {browsing && (
            <button className="btn w-full mt-2" onClick={() => setViewIndex(history.length - 1)}>
              <RotateCcw size={15} /> Back to current position
            </button>
          )}

          {timed && phase === 'playing' && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
              The engine budgets its own thinking time against its clock, so it will speed up when short.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ setup ---

function TimeControlPicker({
  selected,
  onSelect,
  customMinutes,
  customIncrement,
  setCustomMinutes,
  setCustomIncrement
}: {
  selected: TimeControl
  onSelect: (tc: TimeControl) => void
  customMinutes: number
  customIncrement: number
  setCustomMinutes: (n: number) => void
  setCustomIncrement: (n: number) => void
}): React.JSX.Element {
  const custom = customTimeControl(customMinutes, customIncrement)
  const customSelected = selected.id.startsWith('custom-')

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label">Time control</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {CATEGORY_BLURBS[selected.category]}
        </span>
      </div>

      {CATEGORY_ORDER.map((category) => (
        <div key={category} className="mt-3">
          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {CATEGORY_LABELS[category]}
          </div>
          <div className="flex flex-wrap gap-2">
            {inCategory(category).map((tc) => {
              const active = selected.id === tc.id
              return (
                <button
                  key={tc.id}
                  onClick={() => onSelect(tc)}
                  className="btn tabular"
                  style={
                    active
                      ? {
                          borderColor: 'var(--color-accent-500)',
                          background: 'var(--surface-3)',
                          fontWeight: 600
                        }
                      : undefined
                  }
                >
                  {tc.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
          Custom
        </div>
        <div className="flex items-end gap-3">
          <label className="flex-1">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              Minutes per side
            </div>
            <input
              type="number"
              className="input tabular"
              min={0.5}
              max={180}
              step={0.5}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(Math.max(0.5, Math.min(180, Number(e.target.value) || 0.5)))}
            />
          </label>
          <label className="flex-1">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              Increment (seconds)
            </div>
            <input
              type="number"
              className="input tabular"
              min={0}
              max={180}
              step={1}
              value={customIncrement}
              onChange={(e) => setCustomIncrement(Math.max(0, Math.min(180, Number(e.target.value) || 0)))}
            />
          </label>
          <button
            className="btn"
            onClick={() => onSelect(custom)}
            style={
              customSelected
                ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                : undefined
            }
          >
            Use {custom.name}
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          Counts as {CATEGORY_LABELS[custom.category].toLowerCase()} for rating purposes.
        </p>
      </div>
    </div>
  )
}

/** Name, rating, clock, and the material this side has captured. */
function PlayerStrip({
  name,
  rating,
  captured,
  advantage,
  pieceSet,
  color,
  thinking,
  clockMs,
  clockRunning,
  clockIdle,
  lowTimeSec
}: {
  name: string
  rating: number
  captured: PieceType[]
  advantage: number
  pieceSet: string
  color: Color
  thinking: boolean
  clockMs: number | null
  clockRunning: boolean
  clockIdle: boolean
  lowTimeSec: number
}): React.JSX.Element {
  // Show captured pieces largest-first so the readout is easy to scan.
  const order: PieceType[] = ['q', 'r', 'b', 'n', 'p']
  const sorted = [...captured].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const resolvePiece = usePieceResolver(pieceSet, usePieceColors())

  return (
    <div className="flex items-center gap-2 py-1.5" style={{ minHeight: 44 }}>
      <span className="font-semibold text-sm">{name}</span>
      <span className="chip tabular">{rating}</span>
      {thinking && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          thinking…
        </span>
      )}
      <div className="flex items-center ml-1">
        {sorted.map((type, i) => (
          <img
            key={i}
            src={resolvePiece(color === 'w' ? 'b' : 'w', type)}
            alt=""
            className="no-drag"
            style={{ width: 18, height: 18, marginLeft: i > 0 ? -6 : 0, opacity: 0.85 }}
          />
        ))}
        {advantage > 0 && (
          <span className="text-xs tabular ml-1.5" style={{ color: 'var(--text-muted)' }}>
            +{advantage}
          </span>
        )}
      </div>

      {clockMs != null && (
        <div className="ml-auto">
          <Clock
            ms={clockMs}
            running={clockRunning}
            idle={clockIdle}
            color={color}
            lowTimeSec={lowTimeSec}
          />
        </div>
      )}
    </div>
  )
}
