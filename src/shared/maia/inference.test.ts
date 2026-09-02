/**
 * End-to-end check: TypeScript encoding, through the exported ONNX graph, back
 * through TypeScript decoding, compared against what the Python reference
 * produced for the same positions.
 *
 * This is the test that would catch a mirroring or vocabulary mistake, because
 * those produce plausible-looking output that is simply wrong.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import fixtures from './__fixtures__/reference.json'
import { createOrtBackend, type OrtSession, type OrtTensorFactory } from './ort'
import { buildPosition } from './position'
import { MaiaSession } from './session'

const MODEL_PATH = fileURLToPath(
  new URL('../../../resources/engine/maia/maia3-5m.onnx', import.meta.url)
)

// The weights are gitignored, so a fresh clone has to run `npm run maia:export`
// before these can run. Skipping is clearer than failing on a missing file.
const available = existsSync(MODEL_PATH)

async function loadSession(): Promise<MaiaSession> {
  const ort = await import('onnxruntime-node')
  const session = (await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  })) as unknown as OrtSession

  const tensor: OrtTensorFactory = (type, data, dims) =>
    new ort.Tensor(type, data, dims as number[])

  return new MaiaSession(createOrtBackend(session, tensor))
}

describe.skipIf(!available)('inference against the Python reference', () => {
  for (const testCase of fixtures.cases) {
    it(testCase.name, async () => {
      const maia = await loadSession()

      const full = buildPosition(testCase.fen, testCase.moves)
      // Match the fixture's history mode: without history the reference sees
      // only the current position, repeated to fill the window.
      const position = testCase.useHistory
        ? full
        : { ...full, fens: [full.fens.at(-1) as string] }

      const evaluation = await maia.evaluate(position, {
        elo: testCase.elo,
        temperature: 0
      })

      const expectedTop = testCase.top[0]
      expect(evaluation.bestmove).toBe(expectedTop.uci)

      // Ranking and probabilities must line up move for move, not just at the top.
      for (let i = 0; i < testCase.top.length; i++) {
        expect(evaluation.candidates[i].uci).toBe(testCase.top[i].uci)
        expect(evaluation.candidates[i].policy).toBeCloseTo(testCase.top[i].policy, 4)
      }

      expect(evaluation.wdl.win).toBeCloseTo(testCase.wdl.win, 4)
      expect(evaluation.wdl.draw).toBeCloseTo(testCase.wdl.draw, 4)
      expect(evaluation.wdl.loss).toBeCloseTo(testCase.wdl.loss, 4)
    })
  }
})

describe.skipIf(!available)('candidate evaluation', () => {
  it('scores candidates from the mover point of view', async () => {
    const maia = await loadSession()
    const position = buildPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')

    const evaluation = await maia.evaluate(position, {
      elo: 1500,
      temperature: 0,
      evaluateTop: 4
    })

    const scored = evaluation.candidates.slice(0, 4)
    expect(scored.every((candidate) => candidate.wdl !== undefined)).toBe(true)

    // The opening is close to balanced from either side, so no first move
    // should look winning or losing to the model.
    for (const candidate of scored) {
      const wdl = candidate.wdl!
      expect(wdl.win + wdl.draw + wdl.loss).toBeCloseTo(1, 5)
      expect(wdl.win).toBeLessThan(0.9)
      expect(wdl.loss).toBeLessThan(0.9)
    }
  })

  it('sees a mate in one as a certain win without asking the network', async () => {
    const maia = await loadSession()
    // Back-rank mate: Ra8#.
    const position = buildPosition('6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1')

    const evaluation = await maia.evaluate(position, {
      elo: 1500,
      temperature: 0,
      evaluateTop: 30
    })

    const mate = evaluation.candidates.find((candidate) => candidate.uci === 'a1a8')
    expect(mate).toBeDefined()
    expect(mate!.wdl).toEqual({ win: 1, draw: 0, loss: 0 })
  })

  it('treats a finished game as terminal', async () => {
    const maia = await loadSession()
    // Fool's mate: White is to move, is checkmated, and has no reply.
    const position = buildPosition('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')

    expect(position.terminal).toBe(true)
    const evaluation = await maia.evaluate(position, { elo: 1500 })
    expect(evaluation.bestmove).toBeNull()
    expect(evaluation.wdl.loss).toBe(1)
  })
})
