/**
 * Move sounds, synthesised with the Web Audio API.
 *
 * These are modelled rather than sampled. Chess.com's and Lichess's audio are
 * both licensed in ways that rule out reuse — Lichess lists its sound sets
 * under "Exceptions (non-free)" — so the character of a wooden piece on a board
 * is reproduced from first principles instead, which also means the app owns
 * its sounds outright.
 *
 * What makes a knock sound like wood rather than a click is *modal* content: a
 * struck object rings at a handful of frequencies, each decaying at its own
 * rate, with higher modes dying fastest. Each sound here is therefore a sum of
 * exponentially-damped sinusoids plus a very short noise transient for the
 * initial contact. A plain filtered noise burst — which is what this used to be
 * — reads as "shh" rather than "tock", because it has no modal structure at all.
 *
 * Buffers are rendered once and cached, then played back with slight random
 * detune so repeated moves do not sound mechanically identical, the way a real
 * board never does.
 */

export type SoundName = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'success' | 'failure' | 'end'

let context: AudioContext | null = null

function ctx(): AudioContext {
  if (!context) context = new AudioContext()
  // Browsers start the context suspended until a user gesture; every sound we
  // play follows a click, so resuming here is always allowed.
  if (context.state === 'suspended') void context.resume()
  return context
}

/** One resonance of the struck body. */
interface Mode {
  /** Frequency in Hz. */
  f: number
  /** Time constant in seconds; higher modes should decay faster. */
  decay: number
  gain: number
}

interface KnockSpec {
  modes: Mode[]
  /** Level of the initial contact transient, 0-1. */
  noise: number
  /** How quickly that transient dies; a few milliseconds reads as a hard hit. */
  noiseDecay: number
  /** Total buffer length in seconds. */
  duration: number
}

/**
 * Wooden pieces on a wooden board.
 *
 * The fundamental sits low enough to feel solid without being boomy, and the
 * upper modes decay quickly, which is what gives a short "tock" rather than a
 * ringing "bong".
 */
const KNOCKS: Record<string, KnockSpec> = {
  // A piece set down firmly. Tuned tight and dry: the fundamental sits high
  // enough to read as the piece rather than the table, and everything is over
  // inside about a seventh of a second, which is what keeps a fast game from
  // turning into a drum roll.
  move: {
    modes: [
      { f: 330, decay: 0.03, gain: 1.0 },
      { f: 690, decay: 0.02, gain: 0.6 },
      { f: 1180, decay: 0.012, gain: 0.34 },
      { f: 2100, decay: 0.006, gain: 0.18 }
    ],
    noise: 0.55,
    noiseDecay: 0.0022,
    duration: 0.14
  },

  // Two pieces meeting, then one landing. Lower fundamental for weight, but a
  // much stronger contact transient and an extra high mode, so a capture is
  // recognisable without looking at the board.
  capture: {
    modes: [
      { f: 260, decay: 0.042, gain: 1.0 },
      { f: 560, decay: 0.028, gain: 0.75 },
      { f: 1080, decay: 0.018, gain: 0.55 },
      { f: 1980, decay: 0.009, gain: 0.38 },
      { f: 3200, decay: 0.005, gain: 0.22 }
    ],
    noise: 0.95,
    noiseDecay: 0.0035,
    duration: 0.19
  },

  // Rook and king together: the same wood as a move, a touch deeper and softer
  // so the pair reads as one action rather than two unrelated knocks.
  castleThud: {
    modes: [
      { f: 295, decay: 0.034, gain: 1.0 },
      { f: 620, decay: 0.022, gain: 0.5 },
      { f: 1080, decay: 0.011, gain: 0.28 }
    ],
    noise: 0.5,
    noiseDecay: 0.0024,
    duration: 0.16
  }
}

/** Cached rendered buffers, keyed by spec name. */
const buffers = new Map<string, AudioBuffer>()

/**
 * Render a modal knock into an AudioBuffer.
 *
 * Modes are summed with a random starting phase so the transient does not
 * always begin with every partial in step, which would sound synthetic.
 */
function renderKnock(name: string, spec: KnockSpec): AudioBuffer {
  const cached = buffers.get(name)
  if (cached) return cached

  const audio = ctx()
  const rate = audio.sampleRate
  const length = Math.max(1, Math.ceil(rate * spec.duration))
  const buffer = audio.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)

  const phases = spec.modes.map(() => Math.random() * Math.PI * 2)

  for (let i = 0; i < length; i++) {
    const t = i / rate
    let sample = 0

    for (let m = 0; m < spec.modes.length; m++) {
      const mode = spec.modes[m]
      sample += mode.gain * Math.sin(2 * Math.PI * mode.f * t + phases[m]) * Math.exp(-t / mode.decay)
    }

    // Contact transient: broadband, and gone almost immediately.
    if (spec.noise > 0) {
      sample += (Math.random() * 2 - 1) * spec.noise * Math.exp(-t / spec.noiseDecay)
    }

    // A sub-millisecond attack ramp avoids a DC step, which would click.
    const attack = Math.min(1, t / 0.0007)
    data[i] = sample * attack
  }

  // Normalise so the specs can be written by ear-shape rather than by level.
  let peak = 0
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]))
  if (peak > 0) {
    const scale = 0.92 / peak
    for (let i = 0; i < length; i++) data[i] *= scale
  }

  buffers.set(name, buffer)
  return buffer
}

let enabled = true
let masterVolume = 0.6

export function configureSound(on: boolean, volume: number): void {
  enabled = on
  masterVolume = Math.max(0, Math.min(1, volume))
}

/**
 * Play a cached knock.
 *
 * `detune` varies the playback rate slightly on every hit. Real pieces differ
 * in weight and never strike the same spot twice, and without this the sound
 * becomes conspicuously repetitive in a fast game.
 */
function knock(name: string, spec: KnockSpec, gain: number, when = 0): void {
  const audio = ctx()
  const source = audio.createBufferSource()
  source.buffer = renderKnock(name, spec)
  source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.07

  const amp = audio.createGain()
  amp.gain.value = gain * masterVolume * (0.92 + Math.random() * 0.16)

  source.connect(amp).connect(audio.destination)
  source.start(audio.currentTime + when)
}

/** A clean tone, for the feedback cues rather than the board itself. */
function tone(volume: number, frequency: number, duration: number, type: OscillatorType = 'sine', when = 0): void {
  const audio = ctx()
  const osc = audio.createOscillator()
  const amp = audio.createGain()

  osc.type = type
  osc.frequency.value = frequency

  const start = audio.currentTime + when
  amp.gain.setValueAtTime(0, start)
  amp.gain.linearRampToValueAtTime(volume * masterVolume, start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(amp).connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export function play(name: SoundName): void {
  if (!enabled || masterVolume <= 0) return

  try {
    switch (name) {
      case 'move':
        knock('move', KNOCKS.move, 0.55)
        break

      case 'capture':
        knock('capture', KNOCKS.capture, 0.7)
        break

      case 'castle':
        // Two pieces placed in quick succession, the second a little softer.
        knock('castleThud', KNOCKS.castleThud, 0.5)
        knock('castleThud', KNOCKS.castleThud, 0.42, 0.085)
        break

      case 'check':
        // The knock still happens — a piece was moved — with a short bright
        // overtone on top so check is audible without looking.
        knock('move', KNOCKS.move, 0.5)
        tone(0.15, 1320, 0.1, 'triangle', 0.02)
        tone(0.09, 1980, 0.08, 'triangle', 0.02)
        break

      case 'promote':
        knock('move', KNOCKS.move, 0.5)
        tone(0.14, 784, 0.12, 'sine', 0.03)
        tone(0.14, 1175, 0.18, 'sine', 0.11)
        break

      case 'success':
        tone(0.15, 660, 0.11)
        tone(0.15, 988, 0.2, 'sine', 0.1)
        break

      case 'failure':
        // A dull, damped thud rather than a buzz: wrong, not broken.
        knock('capture', KNOCKS.capture, 0.4)
        tone(0.12, 196, 0.22, 'sine', 0.02)
        break

      case 'end':
        tone(0.14, 523, 0.16)
        tone(0.14, 392, 0.32, 'sine', 0.15)
        break
    }
  } catch {
    // Audio is a nicety; never let it break a move.
  }
}

/** Pick the right sound for a move that was just played. */
export function playMoveSound(flags: {
  captured?: boolean
  check?: boolean
  castle?: boolean
  promotion?: boolean
  gameOver?: boolean
}): void {
  if (flags.gameOver) return play('end')
  if (flags.check) return play('check')
  if (flags.promotion) return play('promote')
  if (flags.castle) return play('castle')
  if (flags.captured) return play('capture')
  play('move')
}

/** The knock specifications, exported so they can be analysed offline. */
export { KNOCKS, type KnockSpec }
