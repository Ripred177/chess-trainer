import type { TimeCategory, TimeControl } from '@shared/types'

/**
 * The standard time controls, grouped the way every chess site groups them.
 *
 * Naming follows the usual `initial+increment` convention in minutes and
 * seconds, so `3+2` is three minutes each plus two seconds per move.
 */

const min = (n: number): number => n * 60_000
const sec = (n: number): number => n * 1000

export const UNTIMED: TimeControl = {
  id: 'untimed',
  name: 'Untimed',
  category: 'untimed',
  initialMs: 0,
  incrementMs: 0
}

export const TIME_CONTROLS: TimeControl[] = [
  UNTIMED,

  // ------------------------------------------------------------- bullet --
  { id: '1+0', name: '1+0', category: 'bullet', initialMs: min(1), incrementMs: 0 },
  { id: '1+1', name: '1+1', category: 'bullet', initialMs: min(1), incrementMs: sec(1) },
  { id: '2+1', name: '2+1', category: 'bullet', initialMs: min(2), incrementMs: sec(1) },

  // -------------------------------------------------------------- blitz --
  { id: '3+0', name: '3+0', category: 'blitz', initialMs: min(3), incrementMs: 0 },
  { id: '3+2', name: '3+2', category: 'blitz', initialMs: min(3), incrementMs: sec(2) },
  { id: '5+0', name: '5+0', category: 'blitz', initialMs: min(5), incrementMs: 0 },
  { id: '5+3', name: '5+3', category: 'blitz', initialMs: min(5), incrementMs: sec(3) },

  // -------------------------------------------------------------- rapid --
  { id: '10+0', name: '10+0', category: 'rapid', initialMs: min(10), incrementMs: 0 },
  { id: '10+5', name: '10+5', category: 'rapid', initialMs: min(10), incrementMs: sec(5) },
  { id: '15+10', name: '15+10', category: 'rapid', initialMs: min(15), incrementMs: sec(10) },
  { id: '20+0', name: '20+0', category: 'rapid', initialMs: min(20), incrementMs: 0 },

  // ---------------------------------------------------------- classical --
  { id: '30+0', name: '30+0', category: 'classical', initialMs: min(30), incrementMs: 0 },
  { id: '30+20', name: '30+20', category: 'classical', initialMs: min(30), incrementMs: sec(20) },
  { id: '45+45', name: '45+45', category: 'classical', initialMs: min(45), incrementMs: sec(45) },
  { id: '60+0', name: '60+0', category: 'classical', initialMs: min(60), incrementMs: 0 },
  { id: '90+30', name: '90+30', category: 'classical', initialMs: min(90), incrementMs: sec(30) }
]

export const CATEGORY_ORDER: TimeCategory[] = ['untimed', 'bullet', 'blitz', 'rapid', 'classical']

export const CATEGORY_LABELS: Record<TimeCategory, string> = {
  untimed: 'No clock',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical'
}

export const CATEGORY_BLURBS: Record<TimeCategory, string> = {
  untimed: 'Take as long as you like. Nothing is timed.',
  bullet: 'Under three minutes. Pattern recognition over calculation.',
  blitz: 'Three to eight minutes. Fast, but there is time to think.',
  rapid: 'Ten to twenty-five minutes. Room for real plans.',
  classical: 'Half an hour and up. Deep calculation, no excuses.'
}

/**
 * Which bucket a time control falls into.
 *
 * Uses the standard estimate of a game's length — the initial time plus the
 * increment across an assumed forty moves — so a custom 2+10 is correctly
 * treated as blitz rather than bullet.
 */
export function categorise(initialMs: number, incrementMs: number): TimeCategory {
  if (initialMs <= 0) return 'untimed'
  const estimateSec = (initialMs + incrementMs * 40) / 1000
  if (estimateSec < 179) return 'bullet'
  if (estimateSec < 479) return 'blitz'
  if (estimateSec < 1499) return 'rapid'
  return 'classical'
}

export function getTimeControl(id: string): TimeControl {
  return TIME_CONTROLS.find((t) => t.id === id) ?? UNTIMED
}

export function inCategory(category: TimeCategory): TimeControl[] {
  return TIME_CONTROLS.filter((t) => t.category === category)
}

/** Build a one-off control from minutes and seconds chosen in the UI. */
export function customTimeControl(initialMinutes: number, incrementSeconds: number): TimeControl {
  const initialMs = Math.round(initialMinutes * 60_000)
  const incrementMs = Math.round(incrementSeconds * 1000)
  return {
    id: `custom-${initialMinutes}+${incrementSeconds}`,
    name: `${formatMinutes(initialMinutes)}+${incrementSeconds}`,
    category: categorise(initialMs, incrementMs),
    initialMs,
    incrementMs
  }
}

/** Half-minute controls are common in bullet, so don't force whole numbers. */
function formatMinutes(minutes: number): string {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, '')
}

/**
 * Clock readout.
 *
 * Above twenty seconds a plain `m:ss` is easiest to read at a glance; below it,
 * tenths appear, because in a bullet scramble the tenths are the whole story.
 */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSec = clamped / 1000

  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = Math.floor(totalSec % 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  if (totalSec < 20) {
    const s = Math.floor(totalSec)
    const tenths = Math.floor((clamped % 1000) / 100)
    return `${s}.${tenths}`
  }

  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
