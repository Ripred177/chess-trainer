import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Microscope,
  Trash2,
  FlipVertical2,
  Check,
  Swords,
  Users
} from 'lucide-react'
import type { Color, GameAnalysis, GameRecord, MoveQuality } from '@shared/types'
import Board from '../components/Board'
import EvalBar from '../components/EvalBar'
import { PageHeader, Empty, Stat } from '../components/ui'
import { useBoardColors, useBoardSize, useSettings, useStore } from '../state/useStore'
import { playMoveSound } from '../lib/sound'
import { START_FEN, formatEval, type Square } from '../lib/chess'
import { QUALITY_COLOR, QUALITY_GLYPH, QUALITY_LABEL, reviewGame, type ReviewProgress } from '../lib/review'

export default function GamesView(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Newest first: the game you just played is the one you want to look at.
  const games = useMemo(() => [...(profile?.games ?? [])].reverse(), [profile])
  const selected = games.find((g) => g.id === selectedId) ?? null

  if (selected) {
    return <GameDetail game={selected} onBack={() => setSelectedId(null)} />
  }

  return <GameList games={games} onOpen={setSelectedId} />
}

// ------------------------------------------------------------------- list ---

function GameList({
  games,
  onOpen
}: {
  games: GameRecord[]
  onOpen: (id: string) => void
}): React.JSX.Element {
  const profile = useStore((s) => s.profile)

  const stats = useMemo(() => {
    let wins = 0
    let losses = 0
    let draws = 0
    for (const g of games) {
      if (g.result === '*') continue
      if (g.result === '1/2-1/2') draws++
      else if ((g.result === '1-0') === (g.playerColor === 'w')) wins++
      else losses++
    }
    return { wins, losses, draws, analysed: games.filter((g) => g.analysis).length }
  }, [games])

  if (games.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <PageHeader title="Games" />
        <Empty
          title="No games yet"
          message="Every game you finish — against the engine or against a friend — is saved here, and can be replayed, exported, and reviewed move by move."
        />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="Games"
        subtitle={`${games.length} saved. Click one to replay it move by move, export it, or have the engine review it.`}
      />

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat label="Won" value={stats.wins} tone="good" />
        <Stat label="Lost" value={stats.losses} tone={stats.losses > 0 ? 'bad' : 'default'} />
        <Stat label="Drawn" value={stats.draws} />
        <Stat label="Reviewed" value={stats.analysed} sub={`of ${games.length}`} />
      </div>

      <div className="card overflow-hidden">
        {games.map((game, i) => {
          const won = game.result !== '*' && game.result !== '1/2-1/2'
            ? (game.result === '1-0') === (game.playerColor === 'w')
            : null
          const outcome =
            game.result === '*'
              ? 'Aborted'
              : game.result === '1/2-1/2'
                ? 'Draw'
                : won
                  ? 'Won'
                  : 'Lost'

          return (
            <button
              key={game.id}
              onClick={() => onOpen(game.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors"
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                background: 'transparent'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                className="shrink-0 rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background:
                    game.result === '*'
                      ? 'var(--text-muted)'
                      : won == null
                        ? 'var(--border-strong)'
                        : won
                          ? 'var(--color-accent-500)'
                          : 'var(--color-danger-500)'
                }}
              />

              {game.opponentElo > 0 ? (
                <Swords size={15} style={{ color: 'var(--text-muted)' }} />
              ) : (
                <Users size={15} style={{ color: 'var(--text-muted)' }} />
              )}

              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">
                  {outcome} vs {game.opponent ?? `engine ${game.opponentElo}`}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {new Date(game.at).toLocaleString()} · {game.moveCount} moves · {game.termination}
                </div>
              </div>

              <span className="chip">{game.playerColor === 'w' ? 'White' : 'Black'}</span>
              {game.timeControl && <span className="chip tabular">{game.timeControl.name}</span>}
              {game.analysis && (
                <span className="chip" style={{ color: 'var(--color-accent-400)' }}>
                  <Check size={11} /> reviewed
                </span>
              )}
              <span className="chip tabular">{game.result}</span>
            </button>
          )
        })}
      </div>

      {(profile?.games.length ?? 0) >= 1000 && (
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          The most recent 1000 games are kept; older ones are dropped as new games are played.
        </p>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- detail ---

function GameDetail({ game, onBack }: { game: GameRecord; onBack: () => void }): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()
  const refreshProfile = useStore((s) => s.refreshProfile)
  const setView = useStore((s) => s.setView)
  const setAnalysisImport = useStore((s) => s.setAnalysisImport)

  const [ply, setPly] = useState(-1)
  const [orientation, setOrientation] = useState<Color>(game.playerColor)
  const [copied, setCopied] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(game.analysis ?? null)
  const [progress, setProgress] = useState<ReviewProgress | null>(null)
  const cancelled = useRef(false)

  /** Every position in the game, so scrubbing is instant. */
  const frames = useMemo(() => {
    const replay = new Chess()
    try {
      replay.loadPgn(game.pgn)
    } catch {
      return { fens: [START_FEN], sans: [], moves: [] as { from: Square; to: Square }[] }
    }
    const history = replay.history({ verbose: true })
    const board = new Chess()
    const fens = [board.fen()]
    const moves: { from: Square; to: Square }[] = []
    for (const m of history) {
      board.move({ from: m.from, to: m.to, promotion: m.promotion })
      fens.push(board.fen())
      moves.push({ from: m.from as Square, to: m.to as Square })
    }
    return { fens, sans: history.map((m) => m.san), moves }
  }, [game.pgn])

  const lastPly = frames.sans.length - 1
  const fen = frames.fens[Math.max(0, ply + 1)] ?? START_FEN
  const lastMove = ply >= 0 ? frames.moves[ply] ?? null : null
  const judgement = analysis?.judgements[ply] ?? null

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(-1, Math.min(lastPly, next))
      setPly((current) => {
        if (clamped !== current && clamped >= 0) {
          // Only a real step forward should click; scrubbing back should not.
          if (clamped === current + 1) playMoveSound({ captured: false, check: false })
        }
        return clamped
      })
    },
    [lastPly]
  )

  // Arrow keys are how anyone actually walks through a game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(-1) }
      else if (e.key === 'End') { e.preventDefault(); go(lastPly) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, ply, lastPly])

  useEffect(() => {
    return () => {
      cancelled.current = true
    }
  }, [])

  const copy = useCallback(async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1600)
  }, [])

  const runReview = useCallback(async () => {
    cancelled.current = false
    setProgress({ done: 0, total: frames.fens.length })
    const result = await reviewGame(game.pgn, {
      depth: 14,
      onProgress: setProgress,
      shouldCancel: () => cancelled.current
    })
    setProgress(null)
    if (!result) return
    setAnalysis(result)
    await window.chess.profile.saveGameAnalysis(game.id, result)
    await refreshProfile()
  }, [game.pgn, game.id, frames.fens.length, refreshProfile])

  const summary = analysis?.summary
  const mySide = game.playerColor

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <button className="btn btn-ghost" onClick={onBack}>
          <ChevronLeft size={16} /> All games
        </button>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {new Date(game.at).toLocaleString()} · vs {game.opponent ?? `engine ${game.opponentElo}`} ·{' '}
          {game.termination}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div>
          <div className="flex gap-2">
            {analysis && (
              <EvalBar
                cp={judgement?.evalAfter ?? 0}
                mate={judgement?.mateAfter ?? null}
                height={boardSize}
                orientation={orientation}
              />
            )}
            <Board
              fen={fen}
              orientation={orientation}
              movableFor={null}
              lastMove={lastMove}
              colors={colors}
              pieceSet={settings.pieceSetId}
              size={boardSize}
              showCoordinates={settings.showCoordinates}
              highlightLastMove={settings.highlightLastMove}
              animationMs={settings.animationMs}
            />
          </div>

          <div className="flex gap-2 mt-3">
            <button className="btn" onClick={() => go(-1)} disabled={ply < 0} title="Start (Home)">
              <ChevronsLeft size={16} />
            </button>
            <button className="btn flex-1" onClick={() => go(ply - 1)} disabled={ply < 0} title="Back (←)">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              className="btn flex-1"
              onClick={() => go(ply + 1)}
              disabled={ply >= lastPly}
              title="Forward (→)"
            >
              Forward <ChevronRight size={16} />
            </button>
            <button className="btn" onClick={() => go(lastPly)} disabled={ply >= lastPly} title="End (End)">
              <ChevronsRight size={16} />
            </button>
            <button
              className="btn"
              onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}
              title="Flip the board"
            >
              <FlipVertical2 size={16} />
            </button>
          </div>

          <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
            Arrow keys step through the game; Home and End jump to either end.
          </p>
        </div>

        <div className="w-full max-w-[24rem] lg:w-96 shrink-0">
          {judgement && (
            <div
              className="card p-4 mb-3"
              style={{ borderColor: QUALITY_COLOR[judgement.quality] }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm" style={{ color: QUALITY_COLOR[judgement.quality] }}>
                  {judgement.san} — {QUALITY_LABEL[judgement.quality]}
                </span>
                <span className="chip tabular">
                  {formatEval(judgement.evalAfter, judgement.mateAfter)}
                </span>
              </div>
              {judgement.quality !== 'best' && judgement.best && (
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  {judgement.quality === 'good'
                    ? `Fine. The engine slightly prefers ${judgement.best}.`
                    : `Better was ${judgement.best}, worth about ${(judgement.loss / 100).toFixed(1)} pawns.`}
                </p>
              )}
              {judgement.quality === 'best' && (
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  The engine&apos;s first choice.
                </p>
              )}
            </div>
          )}

          {!analysis && (
            <div className="card p-4 mb-3">
              <div className="label mb-2">Engine review</div>
              {progress ? (
                <>
                  <p className="text-sm mb-2">
                    Analysing… {progress.done} of {progress.total} positions
                  </p>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${(progress.done / progress.total) * 100}%`,
                        background: 'var(--color-accent-500)'
                      }}
                    />
                  </div>
                  <button
                    className="btn w-full mt-3"
                    onClick={() => {
                      cancelled.current = true
                      setProgress(null)
                    }}
                  >
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Have Stockfish grade every move and name the better one where you went wrong. Takes
                    roughly a second per two moves, and the result is saved with the game.
                  </p>
                  <button className="btn btn-primary w-full" onClick={runReview}>
                    <Microscope size={15} /> Review this game
                  </button>
                </>
              )}
            </div>
          )}

          {summary && (
            <div className="card p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Review</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  depth {analysis?.depth}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                <span />
                <span className="text-center font-semibold">You</span>
                <span className="text-center font-semibold">Them</span>
              </div>
              {(['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as MoveQuality[]).map((q) => (
                <div key={q} className="grid grid-cols-3 gap-2 text-sm py-0.5">
                  <span style={{ color: QUALITY_COLOR[q] }}>{QUALITY_LABEL[q]}</span>
                  <span className="text-center tabular">{summary[mySide][q]}</span>
                  <span className="text-center tabular">{summary[mySide === 'w' ? 'b' : 'w'][q]}</span>
                </div>
              ))}
              <div
                className="grid grid-cols-3 gap-2 text-sm pt-2 mt-2"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text-muted)' }}>Avg. loss</span>
                <span className="text-center tabular">{summary.averageLoss[mySide]}cp</span>
                <span className="text-center tabular">
                  {summary.averageLoss[mySide === 'w' ? 'b' : 'w']}cp
                </span>
              </div>
            </div>
          )}

          <div className="card p-2 mb-3" style={{ maxHeight: 260, overflow: 'auto' }}>
            <ReviewMoveList
              sans={frames.sans}
              current={ply}
              analysis={analysis}
              onSelect={(i) => setPly(i)}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="btn" onClick={() => copy('PGN', game.pgn)}>
              <Copy size={15} /> {copied === 'PGN' ? 'Copied' : 'Copy PGN'}
            </button>
            <button className="btn" onClick={() => copy('FEN', fen)}>
              <Copy size={15} /> {copied === 'FEN' ? 'Copied' : 'Copy FEN'}
            </button>
            <button
              className="btn col-span-2"
              onClick={() => {
                // Hand the game to the Analysis board, positioned where you are.
                setAnalysisImport(game.pgn)
                setView('analysis')
              }}
            >
              <Microscope size={15} /> Open in Analysis
            </button>
            <button
              className="btn btn-danger col-span-2"
              onClick={async () => {
                if (!window.confirm('Delete this game from your history?')) return
                await window.chess.profile.deleteGame(game.id)
                await refreshProfile()
                onBack()
              }}
            >
              <Trash2 size={15} /> Delete game
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Move list with review marks, paired into numbered rows. */
function ReviewMoveList({
  sans,
  current,
  analysis,
  onSelect
}: {
  sans: string[]
  current: number
  analysis: GameAnalysis | null
  onSelect: (ply: number) => void
}): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  if (sans.length === 0) {
    return (
      <div className="text-xs p-3" style={{ color: 'var(--text-muted)' }}>
        This game has no recorded moves.
      </div>
    )
  }

  const rows: number[] = []
  for (let i = 0; i < sans.length; i += 2) rows.push(i)

  const cell = (index: number): React.JSX.Element => {
    if (index >= sans.length) return <span />
    const active = index === current
    const quality = analysis?.judgements[index]?.quality
    return (
      <button
        ref={active ? activeRef : undefined}
        onClick={() => onSelect(index)}
        className="text-left px-2 py-1 rounded text-sm transition-colors w-full"
        style={{
          background: active ? 'var(--surface-3)' : 'transparent',
          fontWeight: active ? 600 : 400,
          color: quality && quality !== 'good' ? QUALITY_COLOR[quality] : undefined
        }}
      >
        {sans[index]}
        {quality && QUALITY_GLYPH[quality] && (
          <span className="font-bold ml-0.5">{QUALITY_GLYPH[quality]}</span>
        )}
      </button>
    )
  }

  return (
    <div>
      {rows.map((start) => (
        <div
          key={start}
          className="grid items-center gap-1 px-1"
          style={{ gridTemplateColumns: '2rem 1fr 1fr' }}
        >
          <span className="text-xs tabular text-right pr-1" style={{ color: 'var(--text-muted)' }}>
            {start / 2 + 1}.
          </span>
          {cell(start)}
          {cell(start + 1)}
        </div>
      ))}
    </div>
  )
}
