import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { Play, Square as StopIcon, ChevronLeft, ChevronRight, FlipVertical2, Trash2 } from 'lucide-react'
import type { Color, EngineInfo } from '@shared/types'
import Board from '../components/Board'
import EvalBar from '../components/EvalBar'
import MoveList from '../components/MoveList'
import { PageHeader } from '../components/ui'
import { useBoardColors, useBoardSize, useSettings, useStore } from '../state/useStore'
import { playMoveSound } from '../lib/sound'
import {
  START_FEN,
  formatEval,
  toWhitePov,
  uciLineToSan,
  type PieceType,
  type Square
} from '../lib/chess'

const MULTIPV = 3

export default function AnalysisView(): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const boardSize = useBoardSize()

  const gameRef = useRef(new Chess())
  const [fen, setFen] = useState(START_FEN)
  const [history, setHistory] = useState<string[]>([])
  const [viewIndex, setViewIndex] = useState(-1)
  const [orientation, setOrientation] = useState<Color>('w')
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null)

  const [analysing, setAnalysing] = useState(false)
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [loadText, setLoadText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  /** The position currently on the board, which may be earlier than the game. */
  const displayFen = useMemo(() => {
    if (viewIndex >= history.length - 1) return fen
    const replay = new Chess()
    for (let i = 0; i <= viewIndex; i++) replay.move(history[i])
    return replay.fen()
  }, [viewIndex, history, fen])

  const turn = useMemo(() => (displayFen.split(' ')[1] as Color) ?? 'w', [displayFen])

  // Stream engine updates while a search is running.
  useEffect(() => {
    return window.chess.engine.onInfo(setInfo)
  }, [])

  // A game sent over from the Games screen loads once and is then cleared, so
  // coming back to Analysis later shows what you left rather than that game.
  const analysisImport = useStore((s) => s.analysisImport)
  const setAnalysisImport = useStore((s) => s.setAnalysisImport)
  useEffect(() => {
    if (!analysisImport) return
    const game = new Chess()
    try {
      game.loadPgn(analysisImport)
    } catch {
      setAnalysisImport(null)
      return
    }
    gameRef.current = game
    setFen(game.fen())
    setHistory(game.history())
    setViewIndex(game.history().length - 1)
    setLastMove(null)
    setInfo(null)
    setAnalysisImport(null)
  }, [analysisImport, setAnalysisImport])

  const startAnalysis = useCallback(async () => {
    setAnalysing(true)
    setInfo(null)
    try {
      await window.chess.engine.analyse({ fen: displayFen, depth: 26, multipv: MULTIPV })
    } finally {
      setAnalysing(false)
    }
  }, [displayFen])

  const stopAnalysis = useCallback(async () => {
    await window.chess.engine.abort('analysis')
    setAnalysing(false)
  }, [])

  // Restart the search whenever the position under examination changes.
  useEffect(() => {
    if (!analysing) return
    void (async () => {
      await window.chess.engine.abort('analysis')
      setInfo(null)
      await window.chess.engine.analyse({ fen: displayFen, depth: 26, multipv: MULTIPV })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayFen])

  const onMove = useCallback(
    (from: Square, to: Square, promotion?: PieceType) => {
      // Playing a move from a past position truncates the line, as in any
      // analysis board.
      if (viewIndex < history.length - 1) {
        const replay = new Chess()
        for (let i = 0; i <= viewIndex; i++) replay.move(history[i])
        gameRef.current = replay
      }

      const move = gameRef.current.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) return

      setFen(gameRef.current.fen())
      setHistory(gameRef.current.history())
      setViewIndex(gameRef.current.history().length - 1)
      setLastMove({ from, to })
      playMoveSound({
        captured: Boolean(move.captured),
        check: gameRef.current.inCheck(),
        promotion: Boolean(move.promotion)
      })
    },
    [viewIndex, history]
  )

  const reset = useCallback(() => {
    gameRef.current = new Chess()
    setFen(START_FEN)
    setHistory([])
    setViewIndex(-1)
    setLastMove(null)
    setInfo(null)
  }, [])

  /** Accept either a FEN or a PGN, whichever the text looks like. */
  const load = useCallback(() => {
    const text = loadText.trim()
    if (!text) return
    setLoadError(null)

    const game = new Chess()
    // A PGN has move text or tag pairs; a FEN is a single line of fields.
    const looksLikePgn = text.includes('[') || /\b\d+\.\s/.test(text)

    try {
      if (looksLikePgn) {
        game.loadPgn(text)
      } else {
        game.load(text)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read that position.')
      return
    }

    gameRef.current = game
    setFen(game.fen())
    setHistory(game.history())
    setViewIndex(game.history().length - 1)
    setLastMove(null)
    setInfo(null)
    setLoadText('')
  }, [loadText])

  const lines = info?.lines ?? []
  const best = lines[0]
  const povEval = best ? toWhitePov(best.cp, best.mate, turn) : { cp: null, mate: null }

  return (
    <div className="p-3 sm:p-6">
      <PageHeader
        title="Analysis"
        subtitle="Play through any position with Stockfish at full strength."
        actions={
          <>
            <button className="btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
              <FlipVertical2 size={15} /> Flip
            </button>
            <button className="btn" onClick={reset}>
              <Trash2 size={15} /> Clear
            </button>
            {analysing ? (
              <button className="btn" onClick={stopAnalysis}>
                <StopIcon size={15} /> Stop
              </button>
            ) : (
              <button className="btn btn-primary" onClick={startAnalysis}>
                <Play size={15} /> Analyse
              </button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-4 lg:gap-6 justify-center">
        <div className="flex gap-2">
          <EvalBar
            cp={povEval.cp}
            mate={povEval.mate}
            height={boardSize}
            orientation={orientation}
            loading={analysing && !info}
          />
          <Board
            fen={displayFen}
            orientation={orientation}
            movableFor="both"
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
        </div>

        <div className="w-full max-w-[24rem] lg:w-96 shrink-0">
          <div className="card p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="label">Engine</span>
              {info && (
                <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                  depth {info.depth}
                  {info.nps ? ` · ${(info.nps / 1_000_000).toFixed(1)}M n/s` : ''}
                </span>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {analysing ? 'Thinking…' : 'Press Analyse to evaluate this position.'}
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((line) => {
                  const pov = toWhitePov(line.cp, line.mate, turn)
                  const san = uciLineToSan(displayFen, line.pv.slice(0, 8))
                  return (
                    <div key={line.multipv} className="flex gap-2 text-xs">
                      <span
                        className="tabular font-semibold shrink-0"
                        style={{
                          width: 48,
                          color:
                            (pov.mate ?? 0) !== 0 || (pov.cp ?? 0) > 0
                              ? 'var(--color-accent-400)'
                              : 'var(--text-secondary)'
                        }}
                      >
                        {formatEval(pov.cp, pov.mate)}
                      </span>
                      <span className="font-mono leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {san.join(' ')}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card p-2 mb-3" style={{ maxHeight: 260, overflow: 'auto' }}>
            <MoveList
              moves={history}
              current={viewIndex}
              onSelect={setViewIndex}
              emptyMessage="Play a move, or paste a position below."
            />
          </div>

          <div className="flex gap-2 mb-3">
            <button
              className="btn flex-1"
              onClick={() => setViewIndex((i) => Math.max(-1, i - 1))}
              disabled={viewIndex < 0}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              className="btn flex-1"
              onClick={() => setViewIndex((i) => Math.min(history.length - 1, i + 1))}
              disabled={viewIndex >= history.length - 1}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="card p-4">
            <div className="label mb-2">Load a position</div>
            <textarea
              className="input font-mono"
              rows={3}
              placeholder="Paste a FEN or a PGN…"
              value={loadText}
              spellCheck={false}
              onChange={(e) => setLoadText(e.target.value)}
            />
            {loadError && (
              <div className="text-xs mt-2" style={{ color: 'var(--color-danger-400)' }}>
                {loadError}
              </div>
            )}
            <button className="btn w-full mt-2" onClick={load} disabled={!loadText.trim()}>
              Load
            </button>
            <button
              className="btn btn-ghost w-full mt-2 text-xs"
              onClick={() => void navigator.clipboard.writeText(displayFen)}
            >
              Copy current FEN
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
