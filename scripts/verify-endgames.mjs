/**
 * Checks every position in the endgame library: that the FEN is legal, and
 * that the engine's verdict matches the theoretical result claimed.
 *
 * This still uses Stockfish, deliberately. The app itself plays and analyses
 * with Maia-3, which predicts what a human would do — a useful thing to know
 * and the wrong tool entirely for deciding whether a position is a forced win.
 * Confirming that needs exact search, so this build-time check keeps a real
 * engine.
 *
 * Stockfish is no longer bundled with the app, so point CHESS_TRAINER_SF at a
 * binary you have, or drop one at the default path below.
 *
 * One engine process per position, with stdin held open — closing it makes
 * Stockfish exit before the search produces a score, and sending `quit`
 * aborts the search for the same reason.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ENGINE =
  process.env.CHESS_TRAINER_SF ??
  resolve(here, '../resources/engine/stockfish' + (process.platform === 'win32' ? '.exe' : ''))

if (!existsSync(ENGINE)) {
  console.error(
    [
      `Stockfish not found at ${ENGINE}.`,
      '',
      'The app ships Maia-3 and no longer bundles Stockfish, but verifying a',
      'forced win needs exact search rather than a prediction of human play.',
      'Download a build from https://stockfishchess.org/download/ and either',
      'place it at the path above or set CHESS_TRAINER_SF to point at it.'
    ].join('\n')
  )
  process.exit(1)
}
const MOVETIME = 4000

const src = readFileSync(resolve(here, '../src/renderer/src/data/endgames.ts'), 'utf8')
const re = /id: '([^']+)',\s*\n\s*name: '([^']*)',[\s\S]*?fen: '([^']+)',\s*\n\s*goal: '(win|draw)'/g
const positions = [...src.matchAll(re)].map((m) => ({ id: m[1], name: m[2], fen: m[3], goal: m[4] }))
console.log(`parsed ${positions.length} positions\n`)

function evaluate(fen) {
  return new Promise((resolve) => {
    const engine = spawn(ENGINE)
    let buf = ''
    let last = ''
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      engine.kill()
      resolve(value)
    }
    const timer = setTimeout(() => finish(last), MOVETIME + 15000)

    engine.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line.startsWith('info ') && line.includes(' score ')) last = line
        if (line.startsWith('bestmove')) finish(last)
      }
    })
    engine.on('error', () => finish(''))

    engine.stdin.write(`uci\nposition fen ${fen}\ngo movetime ${MOVETIME}\n`)
    // Deliberately no end()/quit: EOF is treated as quit and kills the search.
  })
}

let bad = 0
for (const p of positions) {
  let legal = true
  let note = ''
  try {
    const c = new Chess(p.fen)
    if (c.moves().length === 0) {
      legal = false
      note = 'no legal moves'
    }
  } catch (e) {
    legal = false
    note = e.message.slice(0, 45)
  }

  const info = await evaluate(p.fen)
  const mate = /score mate (-?\d+)/.exec(info)
  const cp = /score cp (-?\d+)/.exec(info)
  const score = mate ? (Number(mate[1]) > 0 ? 100000 : -100000) : cp ? Number(cp[1]) : null

  const verdict = score === null ? 'none' : score > 400 ? 'win' : score < -400 ? 'loss' : 'draw'
  const ok = legal && verdict === p.goal
  if (!ok) bad++
  const shown = mate ? `#${mate[1]}` : score === null ? '-' : (score / 100).toFixed(2)
  console.log(
    `${ok ? 'ok  ' : 'BAD '} ${p.id.padEnd(24)} want=${p.goal.padEnd(4)} got=${verdict.padEnd(4)} ${shown.padStart(8)}  ${note}`
  )
}
console.log(`\n${positions.length - bad}/${positions.length} verified`)
process.exit(bad ? 1 : 0)
