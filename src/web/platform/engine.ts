// The wasm-only entry: the default build also carries WebGPU, whose runtime
// is twice the size and unusable here anyway.
import * as ort from 'onnxruntime-web/wasm'

import {
  MaiaSession,
  createOrtBackend,
  runSearch,
  type OrtSession,
  type OrtTensorFactory
} from '@shared/maia'
import type { EngineInfo, EngineResult, GoOptions } from '@shared/types'

/**
 * Maia-3 in the browser, through onnxruntime-web.
 *
 * The desktop build runs the same model and the same shared code; only the
 * loading differs. That is the point - the previous browser engine was a
 * different Stockfish build with a different strength mechanism, so the bots
 * genuinely played differently depending on where you opened the app. Now the
 * two ladders are the same code driving the same weights.
 *
 * Two constraints shape this file:
 *
 *  - The web build ships the int8 model (~7MB against 21MB). Measured over 200
 *    positions it picks the same move 98.5% of the time and always stays within
 *    the fp32 top three, which is well inside the model's own sampling noise.
 *  - Threads are off. onnxruntime-web only uses them under cross-origin
 *    isolation, and GitHub Pages cannot send COOP/COEP headers. SIMD carries
 *    the performance instead.
 */

type Listener = (info: EngineInfo) => void

export class WebEngine {
  private session: MaiaSession | null = null
  private loading: Promise<MaiaSession> | null = null
  private listeners = new Set<Listener>()
  /** Bumped by `abort()`; results from an older generation are discarded. */
  private generation = 0

  constructor(private modelUrl: string) {}

  private load(): Promise<MaiaSession> {
    if (this.session) return Promise.resolve(this.session)
    if (this.loading) return this.loading

    this.loading = (async () => {
      // The runtime's wasm is emitted by vite as a hashed asset and referenced
      // from the bundle, so `wasmPaths` must stay unset - pointing it at a
      // directory of our own would ship the same 14MB file twice.
      //
      // Without cross-origin isolation the threaded build silently falls back
      // anyway; asking for one thread keeps it from allocating a worker pool
      // it cannot use.
      ort.env.wasm.numThreads = 1
      ort.env.wasm.simd = true

      const session = (await ort.InferenceSession.create(this.modelUrl, {
        executionProviders: ['wasm'],
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

  /** Start fetching the model before the player asks for a move. */
  async warmup(): Promise<void> {
    await this.load()
  }

  onInfo(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async go(options: GoOptions): Promise<EngineResult> {
    const generation = this.generation
    const session = await this.load()

    const search = await runSearch(session, options)

    if (generation !== this.generation) {
      return { bestmove: null, ponder: null, info: null }
    }

    if (search.info) {
      for (const listener of this.listeners) listener(search.info)
    }
    return search.result
  }

  /**
   * Discard whatever is in flight.
   *
   * A forward pass takes tens of milliseconds, so there is nothing worth
   * interrupting; this marks the result stale so a superseded search cannot
   * move a piece after the player has already moved on.
   */
  abort(): void {
    this.generation++
  }

  terminate(): void {
    this.session = null
    this.loading = null
    this.listeners.clear()
  }
}
