import type { Color } from '@shared/types'
import { formatClock } from '../data/timeControls'

export interface ClockProps {
  ms: number
  /** True when this clock is the one currently ticking. */
  running: boolean
  /** Greys the clock out once the game is over. */
  idle?: boolean
  color: Color
  lowTimeSec?: number
}

/**
 * One side's clock.
 *
 * The running clock is the brightest thing in the panel — in a bullet game the
 * clock is what you are actually looking at, not the board furniture. Low time
 * turns it amber and then red, which reads faster than the digits themselves.
 */
export default function Clock({
  ms,
  running,
  idle = false,
  color,
  lowTimeSec = 10
}: ClockProps): React.JSX.Element {
  const seconds = ms / 1000
  const critical = seconds <= Math.min(lowTimeSec / 2, 5)
  const low = seconds <= lowTimeSec
  const flagged = ms <= 0

  const text = flagged
    ? 'var(--color-danger-400)'
    : critical
      ? 'var(--color-danger-400)'
      : low
        ? 'var(--color-warn-400)'
        : running
          ? 'var(--text-primary)'
          : 'var(--text-secondary)'

  return (
    <div
      className="rounded-lg px-3 py-1.5 tabular font-semibold transition-colors"
      style={{
        minWidth: 96,
        textAlign: 'right',
        fontSize: 22,
        lineHeight: '28px',
        color: text,
        // The active side gets a filled background; the waiting side recedes.
        background: running ? 'var(--surface-3)' : 'var(--surface-2)',
        border: `1px solid ${
          running && low ? (critical ? 'var(--color-danger-500)' : 'var(--color-warn-500)') : 'var(--border-subtle)'
        }`,
        opacity: idle ? 0.55 : 1,
        // A gentle pulse only in the genuinely scary range.
        animation: running && critical && !flagged ? 'clock-pulse 1s ease-in-out infinite' : undefined
      }}
      title={`${color === 'w' ? 'White' : 'Black'} clock`}
    >
      {formatClock(ms)}
    </div>
  )
}
