import type { EngineInfo, EngineLine, EngineResult, GoOptions } from '@shared/types'

/**
 * Stockfish in the browser, speaking UCI over a Web Worker.
 *
 * The desktop build limits strength with `UCI_LimitStrength` and `UCI_Elo`.
 * The browser build does not have them — probing it reports Stockfish
 * 2019-08-15 with only `Skill Level`, `MultiPV`, and `Threads`/`Hash` pinned to
 * 1 and 16MB. So strength is produced entirely by the method the desktop app
 * already uses below 1320: search shallowly, ask for several candidate moves,
 * and sample among them with a temperature that narrows as the target rating
 * rises. Above roughly 2600 the temperature reaches zero and it simply plays
 * its best move.
 *
 * Keeping one mechanism for the whole ladder also keeps it predictable — there
 * is no crossover point where the bot's character suddenly changes.
 */

const MATE_CP = 100_000

/** Above this, the engine plays its first choice. */
const FULL_STRENGTH_ELO = 2600
const EMULATION_FLOOR = 250

/** Where the desktop engine's own limiter used to take over. */
const CLUB_ELO = 1320

type Listener = (info: EngineInfo) => void

interface Pending {
  resolve: (r: EngineResult) => void
  info: EngineInfo
  linesByPv: Map<number, EngineLine>
  emulating: boolean
  elo: number
}

export class WebEngine {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private pending: Pending | null = null
  private listeners = new Set<Listener>()
  private queue: string[] = []

  constructor(private scriptUrl: string) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready

    this.ready = new Promise<void>((resolve, reject) => {
      let worker: Worker
      try {
        worker = new Worker(this.scriptUrl)
      } catch (err) {
        reject(err)
        return
      }
      this.worker = worker

      const onMessage = (event: MessageEvent): void => {
        const line = typeof event.data === 'string' ? event.data : String(event.data)
        if (line.startsWith('uciok')) resolve()
        this.handleLine(line)
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', (e) => reject(new Error(e.message || 'engine worker failed')))

      worker.postMessage('uci')
      // Hash and Threads are fixed in this build, so only MultiPV is worth
      // setting up front.
      worker.postMessage('setoption name MultiPV value 1')
    })

    return this.ready
  }

  private send(command: string): void {
    if (!this.worker) {
      this.queue.push(command)
      return
    }
    this.worker.postMessage(command)
  }

  private handleLine(line: string): void {
    if (line.startsWith('info ')) {
      this.parseInfo(line)
      return
    }

    if (line.startsWith('bestmove')) {
      const pending = this.pending
      this.pending = null
      if (!pending) return

      const parts = line.split(/\s+/)
      const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null
      const ponder = parts[3] ?? null

      pending.info.lines = [...pending.linesByPv.values()].sort((a, b) => a.multipv - b.multipv)

      if (pending.emulating && pending.info.lines.length > 0) {
        const picked = sampleMove(pending.info.lines, pending.elo)
        if (picked) {
          pending.resolve({ bestmove: picked, ponder, info: pending.info })
          return
        }
      }
      pending.resolve({ bestmove, ponder, info: pending.info })
    }
  }

  private parseInfo(line: string): void {
    const pending = this.pending
    if (!pending) return
    if (line.includes(' string ')) return
    if (line.includes('lowerbound') || line.includes('upperbound')) return

    const tokens = line.split(/\s+/)
    let depth = 0
    let multipv = 1
    let cp: number | null = null
    let mate: number | null = null
    let pv: string[] = []
    let sawScore = false

    for (let i = 1; i < tokens.length; i++) {
      switch (tokens[i]) {
        case 'depth': depth = Number(tokens[++i]); break
        case 'seldepth': pending.info.seldepth = Number(tokens[++i]); break
        case 'multipv': multipv = Number(tokens[++i]); break
        case 'nodes': pending.info.nodes = Number(tokens[++i]); break
        case 'nps': pending.info.nps = Number(tokens[++i]); break
        case 'time': pending.info.timeMs = Number(tokens[++i]); break
        case 'hashfull': pending.info.hashfull = Number(tokens[++i]); break
        case 'score':
          sawScore = true
          if (tokens[i + 1] === 'cp') { cp = Number(tokens[i + 2]); i += 2 }
          else if (tokens[i + 1] === 'mate') { mate = Number(tokens[i + 2]); i += 2 }
          break
        case 'pv': pv = tokens.slice(i + 1); i = tokens.length; break
      }
    }

    if (!sawScore || depth === 0) return

    // A deeper iteration supersedes shallower entries entirely.
    if (depth > pending.info.depth) {
      pending.info.depth = depth
      pending.linesByPv.clear()
    }
    if (depth < pending.info.depth) return

    pending.linesByPv.set(multipv, { multipv, depth, cp, mate, pv })
    pending.info.lines = [...pending.linesByPv.values()].sort((a, b) => a.multipv - b.multipv)
    for (const listener of this.listeners) listener({ ...pending.info })
  }

  onInfo(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async go(options: GoOptions): Promise<EngineResult> {
    await this.start()

    // Abandon anything still running; only one search at a time.
    if (this.pending) {
      this.send('stop')
      this.pending.resolve({ bestmove: null, ponder: null, info: null })
      this.pending = null
    }

    const elo = options.strength?.elo ?? FULL_STRENGTH_ELO
    const emulating = options.strength != null && elo < FULL_STRENGTH_ELO

    const multipv = emulating ? Math.max(options.multipv ?? 1, 10) : (options.multipv ?? 1)
    this.send(`setoption name MultiPV value ${multipv}`)

    const position = options.moves?.length
      ? `position fen ${options.fen} moves ${options.moves.join(' ')}`
      : `position fen ${options.fen}`
    this.send(position)

    const limits: string[] = []
    if (options.strength) {
      limits.push(`depth ${emulatedDepth(elo)}`)
      // The browser searches roughly fifteen times slower than the native
      // build, so a time cap matters more here than it does on desktop.
      const budget = options.clock ? clockBudget(options) : options.strength.moveTimeMs
      limits.push(`movetime ${Math.max(60, Math.round(Math.min(budget, 3000)))}`)
    } else {
      if (options.depth) limits.push(`depth ${options.depth}`)
      if (options.movetime) limits.push(`movetime ${Math.round(options.movetime)}`)
      if (limits.length === 0) limits.push('depth 16')
    }

    return new Promise<EngineResult>((resolve) => {
      this.pending = {
        resolve,
        info: { depth: 0, lines: [] },
        linesByPv: new Map(),
        emulating,
        elo
      }
      this.send(`go ${limits.join(' ')}`)
    })
  }

  abort(): void {
    if (!this.pending) return
    this.send('stop')
  }

  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.pending = null
  }
}

/** Which side is to move, so the right half of the clock is read. */
function clockBudget(options: GoOptions): number {
  const base = options.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  const played = options.moves?.length ?? 0
  const turn = played % 2 === 0 ? base : base === 'w' ? 'b' : 'w'
  const clock = options.clock!
  const remaining = turn === 'w' ? clock.wtime : clock.btime
  const increment = turn === 'w' ? clock.winc : clock.binc
  return Math.max(60, Math.min(remaining / 25 + increment * 0.6, remaining - 200))
}

/** Beginners see barely a ply ahead; depth rises smoothly with rating. */
function emulatedDepth(elo: number): number {
  if (elo >= FULL_STRENGTH_ELO) return 16
  if (elo < CLUB_ELO) {
    const t = (CLUB_ELO - Math.max(EMULATION_FLOOR, elo)) / (CLUB_ELO - EMULATION_FLOOR)
    return Math.max(1, Math.round(1 + (1 - t) * 7))
  }
  const t = (elo - CLUB_ELO) / (FULL_STRENGTH_ELO - CLUB_ELO)
  return Math.round(8 + t * 7)
}

/**
 * How far from the best move the bot is willing to stray, in centipawns.
 *
 * Below club level this matches the desktop curve exactly, so the weak bots
 * behave the same on both platforms. Above it, the tolerance decays to nothing
 * by full strength.
 */
function temperature(elo: number): number {
  if (elo >= FULL_STRENGTH_ELO) return 0
  if (elo < CLUB_ELO) {
    const t = (CLUB_ELO - Math.max(EMULATION_FLOOR, elo)) / (CLUB_ELO - EMULATION_FLOOR)
    return 40 + t * t * 710
  }
  const t = (FULL_STRENGTH_ELO - elo) / (FULL_STRENGTH_ELO - CLUB_ELO)
  return 40 * Math.pow(t, 1.5)
}

function lineCp(line: EngineLine): number {
  if (line.mate != null) {
    return line.mate > 0 ? MATE_CP - line.mate * 100 : -MATE_CP - line.mate * 100
  }
  return line.cp ?? 0
}

/**
 * Pick from the ranked candidates with a softmax weighted by how much each
 * move gives up, so weaker bots make plausible human mistakes rather than
 * random ones.
 */
function sampleMove(lines: EngineLine[], elo: number): string | null {
  const usable = lines.filter((l) => l.pv.length > 0)
  if (usable.length === 0) return null
  if (usable.length === 1) return usable[0].pv[0]

  const t = temperature(elo)
  if (t <= 0) return usable[0].pv[0]

  const scores = usable.map(lineCp)
  const best = Math.max(...scores)

  const weights = scores.map((s) => {
    // Never throw away a mate that has already been found.
    if (best >= MATE_CP - 10_000 && s < best - 200) return 0
    return Math.exp((s - best) / t)
  })

  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return usable[0].pv[0]

  let r = Math.random() * total
  for (let i = 0; i < usable.length; i++) {
    r -= weights[i]
    if (r <= 0) return usable[i].pv[0]
  }
  return usable[usable.length - 1].pv[0]
}
