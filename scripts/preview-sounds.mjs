/**
 * Renders the move sounds to WAV files and reports what they actually contain.
 *
 * The synthesis lives in the renderer and runs through Web Audio, which cannot
 * be listened to from a build script. This reproduces the same modal synthesis
 * offline so the result can be auditioned as a file and checked numerically —
 * dominant partials, decay time, and headroom.
 *
 * The mode specifications are read out of `sound.ts` rather than duplicated
 * here, so the preview cannot drift from what the app plays. If that file's
 * shape changes, this fails loudly instead of quietly previewing stale values.
 *
 * Usage: node scripts/preview-sounds.mjs [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(root, 'src/renderer/src/lib/sound.ts')
const RATE = 48000

/** Pull the KNOCKS table out of the renderer source. */
function loadSpecs() {
  const src = readFileSync(SOURCE, 'utf8')
  const start = src.indexOf('const KNOCKS')
  if (start < 0) throw new Error('KNOCKS table not found in sound.ts')

  const open = src.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end < 0) throw new Error('Could not find the end of the KNOCKS table')

  // Strip comments; what remains is plain data written by us.
  const literal = src
    .slice(open, end)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const specs = new Function(`return ${literal}`)()
  const names = Object.keys(specs)
  if (names.length === 0) throw new Error('KNOCKS parsed but empty')
  for (const [name, spec] of Object.entries(specs)) {
    if (!Array.isArray(spec.modes) || spec.modes.length === 0) {
      throw new Error(`${name} has no modes; parse is wrong`)
    }
  }
  return specs
}

/** The same synthesis the renderer performs, at a fixed sample rate. */
function renderKnock(spec, rate = RATE) {
  const length = Math.ceil(rate * spec.duration)
  const data = new Float32Array(length)
  const phases = spec.modes.map(() => Math.random() * Math.PI * 2)

  for (let i = 0; i < length; i++) {
    const t = i / rate
    let sample = 0
    for (let m = 0; m < spec.modes.length; m++) {
      const mode = spec.modes[m]
      sample += mode.gain * Math.sin(2 * Math.PI * mode.f * t + phases[m]) * Math.exp(-t / mode.decay)
    }
    if (spec.noise > 0) {
      sample += (Math.random() * 2 - 1) * spec.noise * Math.exp(-t / spec.noiseDecay)
    }
    data[i] = sample * Math.min(1, t / 0.0007)
  }

  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < length; i++) data[i] *= 0.92 / peak
  return data
}

/** Concatenate with a gap, for the two-hit castle sound. */
function sequence(parts, rate = RATE) {
  const total = Math.max(...parts.map((p) => Math.ceil(p.at * rate) + p.data.length))
  const out = new Float32Array(total)
  for (const part of parts) {
    const offset = Math.ceil(part.at * rate)
    for (let i = 0; i < part.data.length; i++) out[offset + i] += part.data[i] * (part.gain ?? 1)
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0.99) for (let i = 0; i < out.length; i++) out[i] *= 0.99 / peak
  return out
}

function writeWav(path, data, rate = RATE) {
  const buffer = Buffer.alloc(44 + data.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + data.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(data.length * 2, 40)
  for (let i = 0; i < data.length; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2)
  }
  writeFileSync(path, buffer)
}

/** Energy at one frequency, via the Goertzel algorithm. */
function energyAt(data, freq, rate = RATE) {
  const w = (2 * Math.PI * freq) / rate
  const coeff = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < data.length; i++) {
    const s0 = data[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length
}

/** Time for the signal to fall 40dB below its peak — the perceived length. */
function decayMs(data, rate = RATE) {
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  const floor = peak * 0.01
  const window = Math.round(rate * 0.005)
  for (let i = 0; i < data.length; i += window) {
    let localPeak = 0
    for (let j = i; j < Math.min(i + window, data.length); j++) {
      localPeak = Math.max(localPeak, Math.abs(data[j]))
    }
    if (localPeak < floor) return Math.round((i / rate) * 1000)
  }
  return Math.round((data.length / rate) * 1000)
}

function report(name, data, spec) {
  let peak = 0
  for (const v of data) peak = Math.max(peak, Math.abs(v))
  const parts = spec
    ? spec.modes.map((m) => `${m.f}Hz=${energyAt(data, m.f).toFixed(4)}`).join('  ')
    : ''
  // A frequency no mode sits on, as a control: it should be much quieter.
  const control = energyAt(data, 5200).toFixed(4)
  console.log(
    `  ${name.padEnd(9)} peak=${peak.toFixed(2)}  -40dB@${String(decayMs(data)).padStart(3)}ms  ${parts}${
      spec ? `  [5200Hz control=${control}]` : ''
    }`
  )
}

const out = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'release/sound-preview')
mkdirSync(out, { recursive: true })

const specs = loadSpecs()
console.log(`Parsed ${Object.keys(specs).length} knock specs from sound.ts\n`)
console.log('Rendered sounds:')

const move = renderKnock(specs.move)
const capture = renderKnock(specs.capture)
const thud = renderKnock(specs.castleThud)
const castle = sequence([
  { data: thud, at: 0, gain: 1 },
  { data: renderKnock(specs.castleThud), at: 0.085, gain: 0.84 }
])

writeWav(join(out, 'move.wav'), move)
writeWav(join(out, 'capture.wav'), capture)
writeWav(join(out, 'castle.wav'), castle)

report('move', move, specs.move)
report('capture', capture, specs.capture)
report('castle', castle, null)

// A short sequence of moves, to hear the per-hit variation in context.
const rally = sequence(
  [0, 0.42, 0.78, 1.24, 1.6].map((at, i) => ({
    data: i === 2 ? renderKnock(specs.capture) : renderKnock(specs.move),
    at,
    gain: 0.9 + Math.random() * 0.2
  }))
)
writeWav(join(out, 'sequence.wav'), rally)
report('sequence', rally, null)

console.log(`\nWAV files written to ${out}`)
