import type { Color } from '@shared/types'
import { formatEval, winProbability } from '../lib/chess'

/**
 * The vertical evaluation bar beside the board.
 *
 * The white portion is sized by win probability rather than raw centipawns, so
 * the bar moves meaningfully near equality and saturates once a position is
 * already winning — matching how a player reads an advantage.
 */
export default function EvalBar({
  cp,
  mate,
  height,
  orientation = 'w',
  loading = false
}: {
  cp: number | null
  mate: number | null
  height: number
  orientation?: Color
  loading?: boolean
}): React.JSX.Element {
  const probability = winProbability(cp, mate)
  const whiteShare = Math.max(0.02, Math.min(0.98, probability))
  // Flipping the board flips the bar, so "your side" is always at the bottom.
  const bottomShare = orientation === 'w' ? whiteShare : 1 - whiteShare
  const label = formatEval(cp, mate)
  const whiteAhead = probability >= 0.5

  return (
    <div
      className="relative rounded overflow-hidden shrink-0"
      style={{
        width: 22,
        height,
        background: '#2b2b2b',
        opacity: loading ? 0.55 : 1,
        transition: 'opacity 150ms ease'
      }}
      title={`Evaluation: ${label}`}
    >
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: `${bottomShare * 100}%`,
          background: orientation === 'w' ? '#f2f2f2' : '#2b2b2b',
          transition: 'height 240ms ease'
        }}
      />
      {orientation === 'b' && (
        <div
          className="absolute top-0 left-0 right-0"
          style={{
            height: `${(1 - bottomShare) * 100}%`,
            background: '#f2f2f2',
            transition: 'height 240ms ease'
          }}
        />
      )}
      <span
        className="absolute left-0 right-0 text-center tabular font-semibold"
        style={{
          fontSize: 9,
          // Sit the number on whichever side is winning, where there is room.
          [whiteAhead === (orientation === 'w') ? 'bottom' : 'top']: 3,
          color: whiteAhead ? '#2b2b2b' : '#f2f2f2'
        }}
      >
        {label}
      </span>
    </div>
  )
}
