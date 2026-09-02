/**
 * The main-process engine, driven the way `ipc.ts` drives it.
 *
 * These run against the real model, so they are skipped when it has not been
 * exported yet.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Chess } from 'chess.js'
import { afterEach, describe, expect, it } from 'vitest'

import { Engine, EnginePool } from './engine'

const MODEL_PATH = fileURLToPath(
  new URL('../../resources/engine/maia/maia3-5m.onnx', import.meta.url)
)
const available = existsSync(MODEL_PATH)

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function isLegal(fen: string, uci: string, moves: string[] = []): boolean {
  const chess = new Chess(fen)
  for (const move of moves) chess.move({ from: move.slice(0, 2), to: move.slice(2, 4) })
  return chess.moves({ verbose: true }).some((move) => move.from + move.to === uci.slice(0, 4))
}

const engines: Engine[] = []

function makeEngine(): Engine {
  const engine = new Engine({ binaryPath: MODEL_PATH, threads: 2 })
  engines.push(engine)
  return engine
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()))
})

describe.skipIf(!available)('Engine', () => {
  it('plays a legal move at a requested rating', async () => {
    const engine = makeEngine()
    const result = await engine.go({
      fen: START,
      strength: { elo: 900, moveTimeMs: 200 }
    })

    expect(result.bestmove).toBeTruthy()
    expect(isLegal(START, result.bestmove!)).toBe(true)
  })

  it('uses the move history it is given', async () => {
    const engine = makeEngine()
    const moves = ['e2e4', 'e7e5', 'g1f3']
    const result = await engine.go({
      fen: START,
      moves,
      strength: { elo: 1500, moveTimeMs: 200 }
    })

    expect(result.bestmove).toBeTruthy()
    expect(isLegal(START, result.bestmove!, moves)).toBe(true)
  })

  it('ranks and scores candidates when no strength is set', async () => {
    const engine = makeEngine()
    const result = await engine.go({ fen: START, multipv: 4 })

    expect(result.info).not.toBeNull()
    const lines = result.info!.lines
    expect(lines.length).toBeGreaterThanOrEqual(4)

    // Ranked by policy, each carrying an honest WDL and a display centipawn.
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i - 1].policy!).toBeGreaterThanOrEqual(lines[i].policy!)
    }
    expect(lines[0].wdl).toBeDefined()
    expect(lines[0].cp).not.toBeNull()
    expect(lines[0].pv).toHaveLength(1)
    // There is no search behind any of this, and the type says so.
    expect(lines[0].depth).toBe(1)
    expect(lines[0].mate).toBeNull()
  })

  it('emits info for the analysis stream', async () => {
    const engine = makeEngine()
    const seen: unknown[] = []
    engine.on('info', (info) => seen.push(info))

    await engine.go({ fen: START, multipv: 3 })
    expect(seen).toHaveLength(1)
  })

  it('returns no move in a finished game', async () => {
    const engine = makeEngine()
    const result = await engine.go({
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    })

    expect(result.bestmove).toBeNull()
    expect(result.info).toBeNull()
  })

  it('discards a result that was aborted while in flight', async () => {
    const engine = makeEngine()
    const pending = engine.go({ fen: START, strength: { elo: 1500, moveTimeMs: 200 } })
    await engine.abort()

    const result = await pending
    expect(result.bestmove).toBeNull()
  })

  it('reports a missing model clearly', async () => {
    const engine = new Engine({ binaryPath: `${MODEL_PATH}.missing` })
    await expect(engine.go({ fen: START })).rejects.toThrow(/maia:export/)
  })

  it('weaker and stronger ratings do not play identically', async () => {
    // Sharpened sampling at the top and the model's own rating conditioning
    // should separate these; over enough draws they must not be the same move
    // every single time.
    const engine = makeEngine()
    const position = { fen: START, moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] }

    const picks = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const weak = await engine.go({ ...position, strength: { elo: 600, moveTimeMs: 100 } })
      picks.add(weak.bestmove!)
    }
    // A 600 samples at full temperature, so it must show some variety.
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe.skipIf(!available)('EnginePool', () => {
  it('hands the same engine to every caller', async () => {
    const pool = new EnginePool({ binaryPath: MODEL_PATH, threads: 1 })
    try {
      const play = await pool.get('play')
      const analysis = await pool.get('analysis')
      // One stateless session serves everything, unlike the Stockfish processes
      // this replaced.
      expect(play).toBe(analysis)
    } finally {
      await pool.shutdown()
    }
  })
})
