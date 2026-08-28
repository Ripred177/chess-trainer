import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BoardColors, Color } from '@shared/types'
import {
  ALL_SQUARES,
  createGame,
  isLightSquare,
  isPromotion,
  legalDestinations,
  piecesFromFen,
  squareToXY,
  turnFromFen,
  xyToSquare,
  checkedKingSquare,
  type PieceType,
  type PlacedPiece,
  type Square
} from '../lib/chess'
import { usePieceResolver } from '../lib/pieceSprites'
import { usePieceColors } from '../state/useStore'

/** A drawn annotation, as produced by right-click dragging on the board. */
export interface Arrow {
  from: Square
  to: Square
  color: string
}

export interface Circle {
  square: Square
  color: string
}

export interface BoardProps {
  fen: string
  orientation?: Color
  /** Which colours the player may move. `null` makes the board read-only. */
  movableFor?: Color | 'both' | null
  onMove?: (from: Square, to: Square, promotion?: PieceType) => void
  /** Squares to tint, e.g. puzzle feedback. Values are CSS colours. */
  highlights?: Partial<Record<Square, string>>
  lastMove?: { from: Square; to: Square } | null
  arrows?: Arrow[]
  circles?: Circle[]
  /** Called when the player draws or clears annotations with the right button. */
  onAnnotationsChange?: (arrows: Arrow[], circles: Circle[]) => void
  colors: BoardColors
  pieceSet: string
  size: number
  showCoordinates?: boolean
  showLegalMoves?: boolean
  highlightLastMove?: boolean
  animationMs?: number
  autoPromoteToQueen?: boolean
  moveInput?: 'both' | 'drag' | 'click'
  /** Renders the board dimmed and non-interactive, e.g. while the engine thinks. */
  disabled?: boolean
}

/** A piece with a stable identity across positions, so it can be animated. */
interface TrackedPiece extends PlacedPiece {
  id: string
}

let pieceIdCounter = 0

/**
 * Match the pieces in a new position to the ones already on screen so each
 * keeps its identity and animates from its old square instead of teleporting.
 *
 * Pieces that stay put keep their id outright. The rest are paired up by
 * shortest distance within their own colour and type, which correctly handles
 * ordinary moves, captures, and both rooks in a castle.
 */
function reconcilePieces(previous: TrackedPiece[], next: PlacedPiece[]): TrackedPiece[] {
  const result: TrackedPiece[] = []
  const unclaimed = [...previous]

  const groupKey = (p: PlacedPiece): string => `${p.color}${p.type}`
  const pending: PlacedPiece[] = []

  // Pass one: anything on an unchanged square keeps its id.
  for (const piece of next) {
    const idx = unclaimed.findIndex(
      (p) => p.square === piece.square && p.color === piece.color && p.type === piece.type
    )
    if (idx >= 0) {
      result.push({ ...piece, id: unclaimed[idx].id })
      unclaimed.splice(idx, 1)
    } else {
      pending.push(piece)
    }
  }

  // Pass two: pair the movers with the nearest same-kind piece left over.
  for (const piece of pending) {
    const key = groupKey(piece)
    let bestIdx = -1
    let bestDistance = Infinity

    for (let i = 0; i < unclaimed.length; i++) {
      if (groupKey(unclaimed[i]) !== key) continue
      const dx = unclaimed[i].square.charCodeAt(0) - piece.square.charCodeAt(0)
      const dy = Number(unclaimed[i].square[1]) - Number(piece.square[1])
      const distance = dx * dx + dy * dy
      if (distance < bestDistance) {
        bestDistance = distance
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      result.push({ ...piece, id: unclaimed[bestIdx].id })
      unclaimed.splice(bestIdx, 1)
    } else {
      // A promoted piece, or the first render: no predecessor to inherit from.
      result.push({ ...piece, id: `p${++pieceIdCounter}` })
    }
  }

  return result
}

const PROMOTION_CHOICES: PieceType[] = ['q', 'r', 'b', 'n']

/** How far the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 4

export default function Board({
  fen,
  orientation = 'w',
  movableFor = null,
  onMove,
  highlights,
  lastMove,
  arrows = [],
  circles = [],
  onAnnotationsChange,
  colors,
  pieceSet,
  size,
  showCoordinates = true,
  showLegalMoves = true,
  highlightLastMove = true,
  animationMs = 180,
  autoPromoteToQueen = false,
  moveInput = 'both',
  disabled = false
}: BoardProps): React.JSX.Element {
  // Recolouring is read from settings here rather than threaded through every
  // call site, since every board in the app wants the same treatment.
  const pieceColors = usePieceColors()
  const resolvePiece = usePieceResolver(pieceSet, pieceColors)

  const boardRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Square | null>(null)
  const [pending, setPending] = useState<{ from: Square; to: Square } | null>(null)

  const [drag, setDrag] = useState<{
    from: Square
    pieceId: string
    x: number
    y: number
    active: boolean
  } | null>(null)

  const [rightDrag, setRightDrag] = useState<{ from: Square; to: Square } | null>(null)

  const game = useMemo(() => {
    try {
      return createGame(fen)
    } catch {
      return null
    }
  }, [fen])

  const turn = turnFromFen(fen)
  const placement = useMemo(() => piecesFromFen(fen), [fen])

  // Tracked pieces live in a ref so reconciliation sees the previous render's
  // identities rather than a stale closure copy.
  const trackedRef = useRef<TrackedPiece[]>([])
  const [tracked, setTracked] = useState<TrackedPiece[]>([])

  useLayoutEffect(() => {
    const next = reconcilePieces(trackedRef.current, placement)
    trackedRef.current = next
    setTracked(next)
  }, [placement])

  const canMoveColor = useCallback(
    (color: Color): boolean => {
      if (disabled || movableFor == null) return false
      if (movableFor === 'both') return true
      return movableFor === color && turn === color
    },
    [disabled, movableFor, turn]
  )

  const destinations = useMemo(() => {
    if (!selected || !game) return []
    return legalDestinations(game, selected)
  }, [selected, game])

  const checkSquare = useMemo(() => (game ? checkedKingSquare(game) : null), [game])

  const squareSize = size / 8

  /** Translate a pointer event into the square under the cursor. */
  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): Square | null => {
      const rect = boardRef.current?.getBoundingClientRect()
      if (!rect) return null
      const x = Math.floor(((clientX - rect.left) / rect.width) * 8)
      const y = Math.floor(((clientY - rect.top) / rect.height) * 8)
      return xyToSquare(x, y, orientation)
    },
    [orientation]
  )

  /** Apply a move, routing through the promotion picker when one is needed. */
  const attemptMove = useCallback(
    (from: Square, to: Square) => {
      if (!game || !onMove) return
      const legal = legalDestinations(game, from)
      if (!legal.includes(to)) return

      if (isPromotion(game, from, to)) {
        if (autoPromoteToQueen) {
          onMove(from, to, 'q')
        } else {
          setPending({ from, to })
          return
        }
      } else {
        onMove(from, to)
      }
      setSelected(null)
    },
    [game, onMove, autoPromoteToQueen]
  )

  // ------------------------------------------------------------- pointer ---

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return

      // Right button draws annotations rather than moving pieces.
      if (event.button === 2) {
        const square = squareFromPoint(event.clientX, event.clientY)
        if (square) setRightDrag({ from: square, to: square })
        return
      }

      if (event.button !== 0) return

      const square = squareFromPoint(event.clientX, event.clientY)
      if (!square) return

      // A left click always clears annotations, matching every other chess UI.
      if ((arrows.length > 0 || circles.length > 0) && onAnnotationsChange) {
        onAnnotationsChange([], [])
      }

      // Completing a move onto a highlighted destination.
      if (selected && destinations.includes(square)) {
        attemptMove(selected, square)
        return
      }

      const piece = tracked.find((p) => p.square === square)
      if (piece && canMoveColor(piece.color)) {
        setSelected(square)
        if (moveInput !== 'click') {
          setDrag({ from: square, pieceId: piece.id, x: event.clientX, y: event.clientY, active: false })
          ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
        }
        return
      }

      setSelected(null)
    },
    [
      disabled,
      squareFromPoint,
      selected,
      destinations,
      attemptMove,
      tracked,
      canMoveColor,
      moveInput,
      arrows.length,
      circles.length,
      onAnnotationsChange
    ]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (rightDrag) {
        const square = squareFromPoint(event.clientX, event.clientY)
        if (square && square !== rightDrag.to) setRightDrag({ ...rightDrag, to: square })
        return
      }

      if (!drag) return
      const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y)
      setDrag((d) =>
        d ? { ...d, x: event.clientX, y: event.clientY, active: d.active || moved > DRAG_THRESHOLD_PX } : d
      )
    },
    [drag, rightDrag, squareFromPoint]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (rightDrag) {
        const { from, to } = rightDrag
        setRightDrag(null)
        if (onAnnotationsChange) {
          // Shift and alt pick alternate annotation colours, as on Lichess.
          const color = event.shiftKey
            ? 'rgba(90, 160, 240, 0.75)'
            : event.altKey
              ? 'rgba(240, 110, 90, 0.75)'
              : 'rgba(110, 200, 130, 0.78)'

          if (from === to) {
            const existing = circles.findIndex((c) => c.square === from && c.color === color)
            const nextCircles =
              existing >= 0
                ? circles.filter((_, i) => i !== existing)
                : [...circles.filter((c) => c.square !== from), { square: from, color }]
            onAnnotationsChange(arrows, nextCircles)
          } else {
            const existing = arrows.findIndex((a) => a.from === from && a.to === to && a.color === color)
            const nextArrows =
              existing >= 0
                ? arrows.filter((_, i) => i !== existing)
                : [...arrows.filter((a) => !(a.from === from && a.to === to)), { from, to, color }]
            onAnnotationsChange(nextArrows, circles)
          }
        }
        return
      }

      if (!drag) return
      const wasDragging = drag.active
      const from = drag.from
      setDrag(null)

      if (!wasDragging) return // treat as a click; selection is already set

      const target = squareFromPoint(event.clientX, event.clientY)
      if (target && target !== from) {
        attemptMove(from, target)
      } else {
        // Dropped back where it started — keep it selected for click-to-move.
        setSelected(from)
      }
    },
    [drag, rightDrag, squareFromPoint, attemptMove, arrows, circles, onAnnotationsChange]
  )

  // Clear transient interaction state whenever the position changes underneath.
  useEffect(() => {
    setSelected(null)
    setPending(null)
    setDrag(null)
  }, [fen])

  // Escape cancels a selection or a promotion choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setPending(null)
      setSelected(null)
      setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // -------------------------------------------------------------- render ---

  const squares = useMemo(
    () =>
      ALL_SQUARES.map((square) => {
        const { x, y } = squareToXY(square, orientation)
        return { square, x, y, light: isLightSquare(square) }
      }),
    [orientation]
  )

  return (
    <div
      ref={boardRef}
      className="relative select-none no-drag touch-none"
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        overflow: 'hidden',
        opacity: disabled ? 0.85 : 1,
        transition: 'opacity 150ms ease'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null)
        setRightDrag(null)
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Squares, plus coordinate labels along the edges. */}
      {squares.map(({ square, x, y, light }) => {
        const isSelected = selected === square
        const isLast = highlightLastMove && (lastMove?.from === square || lastMove?.to === square)
        const custom = highlights?.[square]

        return (
          <div
            key={square}
            className="absolute"
            style={{
              left: x * squareSize,
              top: y * squareSize,
              width: squareSize,
              height: squareSize,
              background: light ? colors.light : colors.dark
            }}
          >
            {isLast && <div className="absolute inset-0" style={{ background: colors.lastMove }} />}
            {isSelected && <div className="absolute inset-0" style={{ background: colors.selected }} />}
            {checkSquare === square && (
              <div
                className="absolute inset-0"
                style={{
                  background: `radial-gradient(circle at center, ${colors.check} 12%, transparent 72%)`
                }}
              />
            )}
            {custom && <div className="absolute inset-0" style={{ background: custom }} />}

            {showCoordinates && x === 0 && (
              <span
                className="absolute font-semibold pointer-events-none tabular"
                style={{
                  left: squareSize * 0.06,
                  top: squareSize * 0.04,
                  fontSize: Math.max(9, squareSize * 0.19),
                  color: light ? colors.coordLight : colors.coordDark
                }}
              >
                {square[1]}
              </span>
            )}
            {showCoordinates && y === 7 && (
              <span
                className="absolute font-semibold pointer-events-none"
                style={{
                  right: squareSize * 0.06,
                  bottom: squareSize * 0.02,
                  fontSize: Math.max(9, squareSize * 0.19),
                  color: light ? colors.coordLight : colors.coordDark
                }}
              >
                {square[0]}
              </span>
            )}
          </div>
        )
      })}

      {/* Legal-move markers: a dot for a quiet move, a ring for a capture. */}
      {showLegalMoves &&
        selected &&
        destinations.map((square) => {
          const { x, y } = squareToXY(square, orientation)
          const occupied = tracked.some((p) => p.square === square)
          return (
            <div
              key={`dest-${square}`}
              className="absolute pointer-events-none"
              style={{
                left: x * squareSize,
                top: y * squareSize,
                width: squareSize,
                height: squareSize,
                display: 'grid',
                placeItems: 'center'
              }}
            >
              {occupied ? (
                <div
                  style={{
                    width: '86%',
                    height: '86%',
                    borderRadius: '50%',
                    border: `${Math.max(3, squareSize * 0.07)}px solid ${colors.legal}`
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '30%',
                    height: '30%',
                    borderRadius: '50%',
                    background: colors.legal
                  }}
                />
              )}
            </div>
          )
        })}

      {/* Pieces. Each keeps a stable key so CSS transitions animate the move. */}
      {tracked.map((piece) => {
        const { x, y } = squareToXY(piece.square, orientation)
        const isDragging = drag?.active && drag.pieceId === piece.id
        const rect = boardRef.current?.getBoundingClientRect()

        const style: React.CSSProperties = isDragging && rect
          ? {
              // Follow the cursor, centred on it, and float above everything.
              left: drag.x - rect.left - squareSize / 2,
              top: drag.y - rect.top - squareSize / 2,
              width: squareSize,
              height: squareSize,
              transition: 'none',
              zIndex: 30,
              cursor: 'grabbing',
              filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.45))'
            }
          : {
              left: x * squareSize,
              top: y * squareSize,
              width: squareSize,
              height: squareSize,
              transition: animationMs > 0 ? `left ${animationMs}ms ease, top ${animationMs}ms ease` : 'none',
              zIndex: 10,
              cursor: canMoveColor(piece.color) ? 'grab' : 'default'
            }

        return (
          <img
            key={piece.id}
            src={resolvePiece(piece.color, piece.type)}
            alt=""
            draggable={false}
            className="absolute no-drag pointer-events-none"
            style={style}
          />
        )
      })}

      {/* Annotation layer: circles and arrows drawn with the right button. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={size}
        height={size}
        style={{ zIndex: 20 }}
      >
        <defs>
          {[...arrows, ...(rightDrag && rightDrag.from !== rightDrag.to
            ? [{ from: rightDrag.from, to: rightDrag.to, color: 'rgba(110, 200, 130, 0.78)' }]
            : [])].map((arrow, i) => (
            <marker
              key={`head-${i}`}
              id={`arrowhead-${i}`}
              markerWidth="3"
              markerHeight="3"
              refX="1.6"
              refY="1.5"
              orient="auto"
            >
              <polygon points="0,0 3,1.5 0,3" fill={arrow.color} />
            </marker>
          ))}
        </defs>

        {circles.map((circle, i) => {
          const { x, y } = squareToXY(circle.square, orientation)
          return (
            <circle
              key={`circle-${i}`}
              cx={(x + 0.5) * squareSize}
              cy={(y + 0.5) * squareSize}
              r={squareSize * 0.44}
              fill="none"
              stroke={circle.color}
              strokeWidth={squareSize * 0.06}
            />
          )
        })}

        {[...arrows, ...(rightDrag && rightDrag.from !== rightDrag.to
          ? [{ from: rightDrag.from, to: rightDrag.to, color: 'rgba(110, 200, 130, 0.78)' }]
          : [])].map((arrow, i) => {
          const a = squareToXY(arrow.from, orientation)
          const b = squareToXY(arrow.to, orientation)
          const x1 = (a.x + 0.5) * squareSize
          const y1 = (a.y + 0.5) * squareSize
          const x2 = (b.x + 0.5) * squareSize
          const y2 = (b.y + 0.5) * squareSize

          // Stop the shaft short so the arrowhead sits inside the target square.
          const angle = Math.atan2(y2 - y1, x2 - x1)
          const inset = squareSize * 0.34
          return (
            <line
              key={`arrow-${i}`}
              x1={x1}
              y1={y1}
              x2={x2 - Math.cos(angle) * inset}
              y2={y2 - Math.sin(angle) * inset}
              stroke={arrow.color}
              strokeWidth={squareSize * 0.16}
              strokeLinecap="round"
              markerEnd={`url(#arrowhead-${i})`}
            />
          )
        })}
      </svg>

      {/* Promotion picker, anchored over the promoting file. */}
      {pending && (
        <PromotionPicker
          square={pending.to}
          color={turn}
          orientation={orientation}
          squareSize={squareSize}
          resolvePiece={resolvePiece}
          onPick={(type) => {
            onMove?.(pending.from, pending.to, type)
            setPending(null)
            setSelected(null)
          }}
          onCancel={() => {
            setPending(null)
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}

interface PromotionPickerProps {
  square: Square
  color: Color
  orientation: Color
  squareSize: number
  resolvePiece: (color: Color, type: string) => string
  onPick: (type: PieceType) => void
  onCancel: () => void
}

function PromotionPicker({
  square,
  color,
  orientation,
  squareSize,
  resolvePiece,
  onPick,
  onCancel
}: PromotionPickerProps): React.JSX.Element {
  const { x, y } = squareToXY(square, orientation)
  // Open downward unless that would run off the bottom edge.
  const downward = y <= 3
  const top = downward ? y * squareSize : (y - 3) * squareSize
  const order = downward ? PROMOTION_CHOICES : [...PROMOTION_CHOICES].reverse()

  return (
    <>
      <div className="absolute inset-0" style={{ zIndex: 40, background: 'rgba(0,0,0,0.42)' }} onClick={onCancel} />
      <div
        className="absolute card overflow-hidden"
        style={{
          left: x * squareSize,
          top,
          width: squareSize,
          zIndex: 50,
          padding: 0
        }}
      >
        {order.map((type) => (
          <button
            key={type}
            className="block w-full transition-colors"
            style={{ height: squareSize, background: 'var(--surface-1)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-3)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
            onClick={(e) => {
              e.stopPropagation()
              onPick(type)
            }}
            title={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type as 'q' | 'r' | 'b' | 'n']}
          >
            <img
              src={resolvePiece(color, type)}
              alt={type}
              draggable={false}
              className="w-full h-full no-drag"
            />
          </button>
        ))}
      </div>
    </>
  )
}
