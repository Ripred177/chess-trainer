import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import * as ort from 'onnxruntime-node'

import {
  DEFAULT_EVALUATE_TOP,
  MAIA_MAX_ELO,
  MAIA_MIN_ELO,
  MaiaSession,
  buildPosition,
  createOrtBackend,
  runSearch,
  strengthElo,
  type Candidate,
  type OrtSession,
  type OrtTensorFactory
} from '../shared/maia/index.js'
import type { EngineResult, GoOptions, StrengthSpec } from '../shared/types.js'

/**
 * Maia-3 in the main process.
 *
 * This replaced a Stockfish process speaking UCI over stdio, and the difference
 * runs deeper than the transport. Maia does not search: one forward pass gives
 * a probability distribution over legal moves for a player of the requested
 * rating, plus a win/draw/loss estimate. There is no depth to report, no
 * principal variation beyond the move itself, and no centipawn evaluation.
 *
 * The `EngineResult` shape is kept so the renderer keeps working: `cp` carries
 * a display-only figure derived from the value head, and `pv` holds the single
 * move. `policy` and `wdl` on each line are the honest numbers.
 *
 * Strength needs no emulation any more. Stockfish had to be deliberately
 * crippled below 1320; Maia is *trained* on players at each rating, so asking
 * for 800 gets the mistakes an 800 actually makes.
 */

export interface EngineOptions {
  /** Path to the exported ONNX model. */
  binaryPath: string
  threads?: number
  /** Accepted for settings compatibility; the model has no hash table. */
  hashMb?: number
}

/**
 * One loaded model, shared by every caller.
 *
 * Inference is stateless and takes a few milliseconds, so unlike the Stockfish
 * processes this replaced there is no reason to keep separate instances for
 * play and analysis, and nothing to serialise: concurrent searches simply run.
 */
export class Engine extends EventEmitter {
  private session: MaiaSession | null = null
  private loading: Promise<MaiaSession> | null = null
  private inFlight = 0
  /** Bumped by `abort()`; results from an older generation are discarded. */
  private generation = 0

  constructor(private opts: EngineOptions) {
    super()
  }

  async start(): Promise<void> {
    await this.load()
  }

  private load(): Promise<MaiaSession> {
    if (this.session) return Promise.resolve(this.session)
    if (this.loading) return this.loading

    this.loading = (async () => {
      if (!existsSync(this.opts.binaryPath)) {
        throw new Error(
          `Maia model not found at ${this.opts.binaryPath}. Run \`npm run maia:export\`.`
        )
      }

      const session = (await ort.InferenceSession.create(this.opts.binaryPath, {
        executionProviders: ['cpu'],
        // Analysis batches every candidate into one call, so the threads are
        // used well; the default of one leaves most of the machine idle.
        intraOpNumThreads: Math.max(1, this.opts.threads ?? 2),
        graphOptimizationLevel: 'all'
      })) as unknown as OrtSession

      const tensor: OrtTensorFactory = (type, data, dims) =>
        new ort.Tensor(type, data, dims as number[])

      this.session = new MaiaSession(createOrtBackend(session, tensor))
      return this.session
    })()

    // A failed load must not be cached, or every later call inherits the error.
    this.loading.catch(() => {
      this.loading = null
    })

    return this.loading
  }

  async stop(): Promise<void> {
    this.session = null
    this.loading = null
  }

  /** True while a forward pass is outstanding. */
  isBusy(): boolean {
    return this.inFlight > 0
  }

  /**
   * Discard whatever is in flight.
   *
   * There is nothing to interrupt - a forward pass finishes in milliseconds -
   * so this marks the result stale rather than cancelling any work.
   */
  async abort(): Promise<void> {
    this.generation++
  }

  async go(options: GoOptions): Promise<EngineResult> {
    // Captured before the first await: an abort that lands while the model is
    // still loading has to invalidate this call too.
    const generation = this.generation
    const session = await this.load()

    this.inFlight++
    let search: Awaited<ReturnType<typeof runSearch>>
    try {
      search = await runSearch(session, options)
    } finally {
      this.inFlight--
    }

    // Aborted while we were thinking: the caller has moved on.
    if (generation !== this.generation) {
      return { bestmove: null, ponder: null, info: null }
    }

    if (search.info) this.emit('info', search.info)
    return search.result
  }

  /** Ranked candidates, for callers that want Maia's own vocabulary. */
  async candidates(options: GoOptions): Promise<Candidate[]> {
    const session = await this.load()
    const position = buildPosition(options.fen, options.moves ?? [])
    if (position.terminal) return []

    const evaluation = await session.evaluate(position, {
      elo: strengthElo(options.strength),
      temperature: 0,
      evaluateTop: options.multipv ?? DEFAULT_EVALUATE_TOP
    })
    return evaluation.candidates
  }
}

/**
 * Keeps the loaded model available across callers.
 *
 * The Stockfish version of this class existed to stop play and analysis
 * fighting over one process and its transposition table, and to reclaim the
 * ~150MB each process held. A single ONNX session is stateless and costs a
 * fraction of that, so the pool now exists only to share one load and to hand
 * the memory back when the app sits idle.
 */
export type EngineKey = 'play' | 'analysis' | 'review'

/** How long the model may sit unused before it is unloaded. */
const IDLE_SHUTDOWN_MS = 5 * 60_000

const IDLE_SWEEP_MS = 60_000

export class EnginePool {
  private engine: Engine | null = null
  private lastUsed = 0
  private sweeper: NodeJS.Timeout | null = null

  constructor(private opts: EngineOptions) {}

  async get(_key: EngineKey): Promise<Engine> {
    this.lastUsed = Date.now()

    if (!this.engine) {
      this.engine = new Engine(this.opts)
    }

    await this.engine.start()
    this.startSweeper()
    return this.engine
  }

  /** Mark the model in use so a long call is never swept out from under itself. */
  touch(_key: EngineKey): void {
    this.lastUsed = Date.now()
  }

  private startSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => void this.sweep(), IDLE_SWEEP_MS)
    // The sweep timer must never hold the process open on its own.
    this.sweeper.unref?.()
  }

  private async sweep(): Promise<void> {
    if (!this.engine) return
    if (Date.now() - this.lastUsed < IDLE_SHUTDOWN_MS) return
    if (this.engine.isBusy()) return
    await this.engine.stop()
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    await this.engine?.stop()
    this.engine = null
  }
}

export { MAIA_MIN_ELO, MAIA_MAX_ELO }
export type { StrengthSpec }
