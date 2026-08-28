import { useCallback, useEffect, useRef, useState } from 'react'
import type { Color, TimeControl } from '@shared/types'

export interface ClockTimes {
  w: number
  b: number
}

export interface ClockController {
  /** Remaining time, refreshed on a display tick. */
  times: ClockTimes
  /** Whichever side ran out, once one has. */
  flagged: Color | null
  /** Side whose clock is currently running, or null when stopped. */
  active: Color | null
  /** Begin timing, with `turn` on the move. */
  start: (turn: Color) => void
  /** Record that `mover` completed a move: apply increment and switch sides. */
  press: (mover: Color) => void
  /** Halt both clocks, e.g. at game end. */
  stop: () => void
  reset: () => void
  /** Exact remaining time right now, without waiting for the next tick. */
  read: () => ClockTimes
  /**
   * Overwrite both clocks.
   *
   * Used in peer play, where the host's clock is authoritative and the guest
   * adopts its values rather than trusting its own drift.
   */
  setTimes: (times: ClockTimes) => void
}

/** Display refresh rate. Accuracy comes from timestamps, not this interval. */
const TICK_MS = 100

/**
 * A two-sided chess clock.
 *
 * Remaining time is always derived from `performance.now()` deltas rather than
 * by counting ticks, so the clock cannot drift and stays correct even when
 * Chromium throttles timers — a backgrounded window updates the display less
 * often, but the elapsed time it applies on the next tick is still exact.
 */
export function useClock(
  control: TimeControl,
  onFlag?: (color: Color) => void,
  onLowTime?: (color: Color) => void,
  lowTimeSec = 10
): ClockController {
  const untimed = control.initialMs <= 0

  const state = useRef({
    w: control.initialMs,
    b: control.initialMs,
    active: null as Color | null,
    last: 0,
    flagged: null as Color | null,
    /** Low-time warning fires once per side per game. */
    warned: { w: false, b: false }
  })

  const [times, setTimes] = useState<ClockTimes>({ w: control.initialMs, b: control.initialMs })
  const [flagged, setFlagged] = useState<Color | null>(null)
  const [active, setActive] = useState<Color | null>(null)

  // Callbacks live in refs so the ticking effect never needs to re-subscribe.
  const flagCb = useRef(onFlag)
  const lowCb = useRef(onLowTime)
  flagCb.current = onFlag
  lowCb.current = onLowTime

  /** Charge elapsed time to whoever is on the move. */
  const settle = useCallback((): void => {
    const s = state.current
    const now = performance.now()

    if (s.active && !s.flagged) {
      const elapsed = now - s.last
      s[s.active] = s[s.active] - elapsed

      if (s[s.active] <= 0) {
        s[s.active] = 0
        const out = s.active
        s.flagged = out
        s.active = null
        setFlagged(out)
        setActive(null)
        flagCb.current?.(out)
      } else if (!s.warned[s.active] && s[s.active] <= lowTimeSec * 1000) {
        s.warned[s.active] = true
        lowCb.current?.(s.active)
      }
    }

    s.last = now
  }, [lowTimeSec])

  // Display tick. Untimed games never start a timer at all.
  useEffect(() => {
    if (untimed) return
    const id = setInterval(() => {
      const s = state.current
      if (!s.active) return
      settle()
      setTimes({ w: s.w, b: s.b })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [untimed, settle])

  const start = useCallback(
    (turn: Color) => {
      if (untimed) return
      const s = state.current
      s.last = performance.now()
      s.active = turn
      setActive(turn)
    },
    [untimed]
  )

  const press = useCallback(
    (mover: Color) => {
      if (untimed) return
      const s = state.current

      // Charge the mover for the time they actually used before crediting the
      // increment, so a move made with 0.2s left still flags.
      settle()
      if (s.flagged) return

      s[mover] = s[mover] + control.incrementMs
      // Regaining time above the warning threshold re-arms the warning.
      if (s[mover] > lowTimeSec * 1000) s.warned[mover] = false

      s.active = mover === 'w' ? 'b' : 'w'
      s.last = performance.now()
      setActive(s.active)
      setTimes({ w: s.w, b: s.b })
    },
    [untimed, control.incrementMs, settle, lowTimeSec]
  )

  const stop = useCallback(() => {
    if (untimed) return
    settle()
    const s = state.current
    s.active = null
    setActive(null)
    setTimes({ w: s.w, b: s.b })
  }, [untimed, settle])

  const reset = useCallback(() => {
    const s = state.current
    s.w = control.initialMs
    s.b = control.initialMs
    s.active = null
    s.flagged = null
    s.last = performance.now()
    s.warned = { w: false, b: false }
    setTimes({ w: control.initialMs, b: control.initialMs })
    setFlagged(null)
    setActive(null)
  }, [control.initialMs])

  const read = useCallback((): ClockTimes => {
    // Settling first means callers get the true remaining time, not the value
    // as of the last display tick — which matters when handing the engine its
    // time budget.
    if (!untimed) settle()
    return { w: state.current.w, b: state.current.b }
  }, [untimed, settle])

  const setTimesExternal = useCallback((next: ClockTimes) => {
    const s = state.current
    s.w = next.w
    s.b = next.b
    // Rebase the elapsed-time origin, or the next tick would charge the mover
    // for time that has already been accounted for upstream.
    s.last = performance.now()
    if (s.w > 0 && s.b > 0) s.flagged = null
    setTimes({ w: s.w, b: s.b })
  }, [])

  // Starting a new game with a different control must rebase both clocks.
  useEffect(() => {
    reset()
  }, [control.id, reset])

  return { times, flagged, active, start, press, stop, reset, read, setTimes: setTimesExternal }
}

/**
 * Whether `color` has enough material to deliver mate.
 *
 * This decides what a flag actually means: under FIDE rules, running out of
 * time is only a loss if the opponent could conceivably mate. A lone king, or a
 * king with a single minor piece, cannot — so the game is drawn instead.
 */
export function hasMatingMaterial(fen: string, color: Color): boolean {
  const placement = fen.split(' ')[0]
  let minors = 0

  for (const ch of placement) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue
    const isWhite = ch === ch.toUpperCase()
    if ((color === 'w') !== isWhite) continue

    switch (ch.toLowerCase()) {
      case 'p':
      case 'r':
      case 'q':
        // A pawn can promote; rooks and queens mate outright.
        return true
      case 'b':
      case 'n':
        minors++
        break
    }
  }

  // Two minors can force mate (or at least allow it), one cannot.
  return minors >= 2
}
