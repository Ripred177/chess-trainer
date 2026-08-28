import { useEffect, useRef } from 'react'

export interface MoveListProps {
  /** SAN for every half-move played, in order. */
  moves: string[]
  /** Index of the half-move currently shown, or -1 for the starting position. */
  current: number
  onSelect?: (index: number) => void
  /** Per-half-move annotation glyphs from game review, e.g. '??' or '!'. */
  marks?: Record<number, { glyph: string; color: string }>
  emptyMessage?: string
}

/**
 * Scrollable move list, paired into numbered rows.
 *
 * Clicking a move jumps the board to that position, which is what makes the
 * same component usable for both live play and post-game review.
 */
export default function MoveList({
  moves,
  current,
  onSelect,
  marks,
  emptyMessage = 'No moves yet.'
}: MoveListProps): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement>(null)

  // Keep the move being viewed in sight as the game grows.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  if (moves.length === 0) {
    return (
      <div className="text-xs p-3" style={{ color: 'var(--text-muted)' }}>
        {emptyMessage}
      </div>
    )
  }

  const rows: { number: number; white?: string; black?: string; whiteIdx: number; blackIdx: number }[] = []
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      number: i / 2 + 1,
      white: moves[i],
      black: moves[i + 1],
      whiteIdx: i,
      blackIdx: i + 1
    })
  }

  const cell = (san: string | undefined, index: number): React.JSX.Element => {
    if (!san) return <span />
    const active = index === current
    const mark = marks?.[index]
    return (
      <button
        ref={active ? activeRef : undefined}
        onClick={() => onSelect?.(index)}
        className="text-left px-2 py-1 rounded text-sm transition-colors w-full"
        style={{
          background: active ? 'var(--surface-3)' : 'transparent',
          fontWeight: active ? 600 : 400
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = 'var(--surface-2)'
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent'
        }}
      >
        {san}
        {mark && (
          <span className="font-bold ml-0.5" style={{ color: mark.color }}>
            {mark.glyph}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="overflow-auto">
      {rows.map((row) => (
        <div
          key={row.number}
          className="grid items-center gap-1 px-1"
          style={{ gridTemplateColumns: '2rem 1fr 1fr' }}
        >
          <span className="text-xs tabular text-right pr-1" style={{ color: 'var(--text-muted)' }}>
            {row.number}.
          </span>
          {cell(row.white, row.whiteIdx)}
          {cell(row.black, row.blackIdx)}
        </div>
      ))}
    </div>
  )
}
