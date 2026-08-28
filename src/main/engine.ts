import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, accessSync, chmodSync, constants } from 'node:fs'
import type {
  ClockBudget,
  EngineInfo,
  EngineLine,
  EngineResult,
  GoOptions,
  StrengthSpec
} from '../shared/types.js'

/**
 * Stockfish's own strength limiter bottoms out at 1320 Elo, which is still a
 * decent club player. Anything below that we emulate: search very shallowly and
 * sample from the engine's ranked move list with a temperature that widens as
 * the target rating drops, so the bot plays humanly bad moves rather than
 * random ones.
 */
const SF_MIN_ELO = 1320
const SF_MAX_ELO = 3190
const EMULATION_FLOOR = 250

/** Mate scores are folded into centipawns so one comparison covers both. */
const MATE_CP = 100_000

export interface EngineOptions {
  binaryPath: string
  threads?: number
  hashMb?: number
}

interface PendingGo {
  resolve: (r: EngineResult) => void
  reject: (e: Error) => void
  info: EngineInfo
  /** Highest multipv index seen at the deepest completed iteration. */
  linesByPv: Map<number, EngineLine>
}

/**
 * A single Stockfish process speaking UCI over stdio.
 *
 * Emits `info` (EngineInfo) while searching and `error` on process failure.
 * All public methods serialise onto one search at a time; starting a new search
 * stops the one in flight.
 */
export class Engine extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private readyWaiters: (() => void)[] = []
  private pending: PendingGo | null = null
  private searching = false
  private opts: EngineOptions
  /** Set while we are intentionally discarding a search's bestmove. */
  private abandonNext = false

  constructor(opts: EngineOptions) {
    super()
    this.opts = opts
  }

  async start(): Promise<void> {
    if (this.proc) return
    if (!existsSync(this.opts.binaryPath)) {
      throw new Error(`Stockfish binary not found at ${this.opts.binaryPath}`)
    }

    // The Linux engine is packaged from a Windows machine, where NTFS has no
    // executable bit to carry across. Restore it rather than failing to spawn.
    if (process.platform !== 'win32') {
      try {
        accessSync(this.opts.binaryPath, constants.X_OK)
      } catch {
        try {
          chmodSync(this.opts.binaryPath, 0o755)
        } catch (err) {
          throw new Error(
            `Stockfish at ${this.opts.binaryPath} is not executable and could not be made so: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      }
    }

    this.proc = spawn(this.opts.binaryPath, [], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.proc.on('error', (err) => this.emit('error', err))
    this.proc.on('exit', (code) => {
      this.proc = null
      if (this.pending) {
        this.pending.reject(new Error(`Engine exited with code ${code}`))
        this.pending = null
      }
    })

    this.send('uci')
    await this.waitFor('uciok')

    this.setOption('Threads', String(this.opts.threads ?? 2))
    this.setOption('Hash', String(this.opts.hashMb ?? 256))
    this.setOption('Ponder', 'false')

    await this.isready()
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    this.send('quit')
    const proc = this.proc
    this.proc = null
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill()
        resolve()
      }, 1000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private send(cmd: string): void {
    this.proc?.stdin.write(cmd + '\n')
  }

  private setOption(name: string, value: string): void {
    this.send(`setoption name ${name} value ${value}`)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.handleLine(line)
    }
  }

  private lineWaiters: { match: (l: string) => boolean; resolve: () => void }[] = []

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => {
      this.lineWaiters.push({ match: (l) => l.startsWith(token), resolve })
    })
  }

  private handleLine(line: string): void {
    for (let i = this.lineWaiters.length - 1; i >= 0; i--) {
      if (this.lineWaiters[i].match(line)) {
        this.lineWaiters[i].resolve()
        this.lineWaiters.splice(i, 1)
      }
    }

    if (line.startsWith('readyok')) {
      this.readyWaiters.splice(0).forEach((w) => w())
      return
    }

    if (line.startsWith('info ')) {
      this.parseInfo(line)
      return
    }

    if (line.startsWith('bestmove')) {
      this.searching = false
      const parts = line.split(/\s+/)
      const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null
      const ponder = parts[3] ?? null
      const pending = this.pending
      this.pending = null
      if (!pending) return
      if (this.abandonNext) {
        this.abandonNext = false
        pending.resolve({ bestmove: null, ponder: null, info: null })
        return
      }
      pending.info.lines = [...pending.linesByPv.values()].sort((a, b) => a.multipv - b.multipv)
      pending.resolve({ bestmove, ponder, info: pending.info })
    }
  }

  private parseInfo(line: string): void {
    const pending = this.pending
    if (!pending) return

    // `info string ...` and lowerbound/upperbound lines carry no usable score.
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
        case 'depth':
          depth = Number(tokens[++i])
          break
        case 'seldepth':
          pending.info.seldepth = Number(tokens[++i])
          break
        case 'multipv':
          multipv = Number(tokens[++i])
          break
        case 'nodes':
          pending.info.nodes = Number(tokens[++i])
          break
        case 'nps':
          pending.info.nps = Number(tokens[++i])
          break
        case 'time':
          pending.info.timeMs = Number(tokens[++i])
          break
        case 'hashfull':
          pending.info.hashfull = Number(tokens[++i])
          break
        case 'score':
          sawScore = true
          if (tokens[i + 1] === 'cp') {
            cp = Number(tokens[i + 2])
            i += 2
          } else if (tokens[i + 1] === 'mate') {
            mate = Number(tokens[i + 2])
            i += 2
          }
          break
        case 'pv':
          pv = tokens.slice(i + 1)
          i = tokens.length
          break
      }
    }

    if (!sawScore || depth === 0) return

    // A deeper iteration supersedes shallower multipv entries entirely.
    if (depth > pending.info.depth) {
      pending.info.depth = depth
      pending.linesByPv.clear()
    }
    if (depth < pending.info.depth) return

    pending.linesByPv.set(multipv, { multipv, depth, cp, mate, pv })
    pending.info.lines = [...pending.linesByPv.values()].sort((a, b) => a.multipv - b.multipv)
    this.emit('info', { ...pending.info })
  }

  private isready(): Promise<void> {
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve)
      this.send('isready')
    })
  }

  /** True while a search is running; the pool must not stop a busy engine. */
  isBusy(): boolean {
    return this.searching
  }

  /** Abort the search in flight, discarding its result. */
  async abort(): Promise<void> {
    if (!this.searching) return
    this.abandonNext = true
    this.send('stop')
    await this.isready()
  }

  /**
   * Run a search. Resolves with the engine's chosen move; for targets below
   * Stockfish's 1320 Elo floor, the move is sampled from the ranked list rather
   * than taken from `bestmove`.
   */
  async go(options: GoOptions): Promise<EngineResult> {
    if (!this.proc) await this.start()
    if (this.searching) await this.abort()

    const strength = options.strength
    const emulating = strength != null && strength.elo < SF_MIN_ELO

    // When emulating we need a ranked move list to sample from.
    const multipv = emulating ? Math.max(options.multipv ?? 1, 12) : (options.multipv ?? 1)
    this.setOption('MultiPV', String(multipv))

    if (strength && !emulating) {
      const elo = Math.min(SF_MAX_ELO, Math.round(strength.elo))
      this.setOption('UCI_LimitStrength', 'true')
      this.setOption('UCI_Elo', String(elo))
      this.setOption('Skill Level', '20')
    } else if (emulating) {
      this.setOption('UCI_LimitStrength', 'false')
      this.setOption('Skill Level', '20') // we do the weakening ourselves
    } else {
      this.setOption('UCI_LimitStrength', 'false')
      this.setOption('Skill Level', '20')
    }

    await this.isready()

    const posCmd = options.moves?.length
      ? `position fen ${options.fen} moves ${options.moves.join(' ')}`
      : `position fen ${options.fen}`
    this.send(posCmd)

    const clock = options.clock
    const limits: string[] = []

    if (emulating) {
      // Weak bots think shallowly by design, but in a bullet game even that
      // has to fit inside the clock, so cap it against the time remaining.
      const budget = clock ? emulatedBudget(clock, sideToMove(options)) : Infinity
      limits.push(`depth ${emulatedDepth(strength!.elo)}`)
      limits.push(`movetime ${Math.max(20, Math.min(strength!.moveTimeMs, 400, budget))}`)
    } else if (clock) {
      // Hand Stockfish the clocks and let it allocate its own thinking time.
      // Its time management is far better than any fixed per-move budget, and
      // it is what makes the engine speed up when it is short of time.
      limits.push(
        `wtime ${Math.max(1, Math.round(clock.wtime))}`,
        `btime ${Math.max(1, Math.round(clock.btime))}`,
        `winc ${Math.max(0, Math.round(clock.winc))}`,
        `binc ${Math.max(0, Math.round(clock.binc))}`
      )
    } else {
      if (options.depth) limits.push(`depth ${options.depth}`)
      if (options.nodes) limits.push(`nodes ${options.nodes}`)
      const mt = options.movetime ?? strength?.moveTimeMs
      if (mt) limits.push(`movetime ${Math.round(mt)}`)
      if (limits.length === 0) limits.push('depth 20')
    }

    const result = await new Promise<EngineResult>((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        info: { depth: 0, lines: [] },
        linesByPv: new Map()
      }
      this.searching = true
      this.send(`go ${limits.join(' ')}`)
    })

    if (emulating && result.info && result.info.lines.length > 0) {
      const picked = sampleWeakMove(result.info.lines, strength!.elo)
      if (picked) return { ...result, bestmove: picked }
    }
    return result
  }
}

/** Collapse a line's score to plain centipawns for comparison. */
function lineCp(line: EngineLine): number {
  if (line.mate != null) {
    return line.mate > 0 ? MATE_CP - line.mate * 100 : -MATE_CP - line.mate * 100
  }
  return line.cp ?? 0
}

/**
 * Which side is to move, accounting for any moves played on from `fen`.
 *
 * Needed only to read the right half of the clock, so it works off the FEN's
 * side-to-move field and the parity of the move list rather than replaying the
 * game properly.
 */
function sideToMove(options: GoOptions): 'w' | 'b' {
  const base = options.fen.split(' ')[1] === 'b' ? 'b' : 'w'
  const played = options.moves?.length ?? 0
  if (played % 2 === 0) return base
  return base === 'w' ? 'b' : 'w'
}

/**
 * Time a weakened bot may spend, given the clock.
 *
 * Roughly a twentieth of what is left, always leaving a safety margin so the
 * bot never flags itself on the very move it is calculating.
 */
function emulatedBudget(clock: ClockBudget, turn: 'w' | 'b'): number {
  const remaining = turn === 'w' ? clock.wtime : clock.btime
  const increment = turn === 'w' ? clock.winc : clock.binc
  const safe = Math.max(0, remaining - 150)
  return Math.max(20, Math.min(safe / 20 + increment * 0.5, safe))
}

/** Beginners see barely a ply ahead; the floor rises smoothly toward 1320. */
function emulatedDepth(elo: number): number {
  const t = normalizeWeak(elo)
  // 250 Elo -> depth 1, 1320 Elo -> depth 8
  return Math.max(1, Math.round(1 + (1 - t) * 7))
}

/** 0 at Stockfish's floor, 1 at the weakest bot we offer. */
function normalizeWeak(elo: number): number {
  const clamped = Math.max(EMULATION_FLOOR, Math.min(SF_MIN_ELO, elo))
  return (SF_MIN_ELO - clamped) / (SF_MIN_ELO - EMULATION_FLOOR)
}

/**
 * Pick a move from the engine's ranked list with a softmax weighted by how much
 * each move loses. The temperature widens as the target rating falls, so a
 * 400-rated bot regularly hangs material while a 1200-rated bot only slips
 * occasionally — and both stay inside the set of moves a person might actually
 * consider.
 */
function sampleWeakMove(lines: EngineLine[], elo: number): string | null {
  const usable = lines.filter((l) => l.pv.length > 0)
  if (usable.length === 0) return null
  if (usable.length === 1) return usable[0].pv[0]

  const t = normalizeWeak(elo)
  // Temperature in centipawns: 40cp near 1320, ~750cp at the very bottom.
  const temperature = 40 + t * t * 710

  const scores = usable.map(lineCp)
  const best = Math.max(...scores)

  const weights = scores.map((s) => {
    // Never sample a move that throws away a forced mate we already have.
    if (best >= MATE_CP - 10_000 && s < best - 200) return 0
    return Math.exp((s - best) / temperature)
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

/**
 * Keeps one long-lived engine per purpose so play and background analysis never
 * fight over the same process or transposition table.
 */
/**
 * Keeps long-lived engines so play and background analysis never fight over one
 * process or transposition table.
 *
 * Two things here matter for memory. Each Stockfish process costs roughly 150MB
 * before any hash is allocated, because the NNUE evaluation networks are
 * resident, and the hash table sits on top of that. So:
 *
 * - Review shares the analysis engine. They are never used at the same time —
 *   review backs the hint button and game review, analysis backs the Analysis
 *   screen — and a whole extra process is a high price for that separation.
 * - Idle engines are shut down. `go()` restarts a stopped engine transparently,
 *   so releasing one costs a few hundred milliseconds the next time it is
 *   needed and reclaims several hundred megabytes in the meantime.
 */
export type EngineKey = 'play' | 'analysis' | 'review'

/** How long an engine may sit unused before its memory is handed back. */
const IDLE_SHUTDOWN_MS = 3 * 60_000

/** How often to look for idle engines. */
const IDLE_SWEEP_MS = 30_000

/**
 * Sized by measurement, not guesswork: on a 2s search, 16MB cost about ten ply
 * of depth against 32-64MB, while 32MB came within a couple of ply of much
 * larger tables. Weak bots search too shallowly for the table to matter at all,
 * so this only has to serve the strongest opponents.
 */
const PLAY_HASH_MB = 32

export class EnginePool {
  private engines = new Map<string, Engine>()
  private lastUsed = new Map<string, number>()
  private sweeper: NodeJS.Timeout | null = null

  constructor(private opts: EngineOptions) {}

  /** Review and analysis are the same underlying process. */
  private slotFor(key: EngineKey): 'play' | 'analysis' {
    return key === 'play' ? 'play' : 'analysis'
  }

  async get(key: EngineKey): Promise<Engine> {
    const slot = this.slotFor(key)
    this.lastUsed.set(slot, Date.now())

    let engine = this.engines.get(slot)
    if (!engine) {
      // Analysis gets more muscle; the play engine is deliberately modest so a
      // weak bot doesn't burn eight cores to blunder on purpose.
      const threads = slot === 'play' ? 1 : (this.opts.threads ?? 2)
      const hashMb = slot === 'play' ? PLAY_HASH_MB : (this.opts.hashMb ?? 128)
      engine = new Engine({ ...this.opts, threads, hashMb })
      this.engines.set(slot, engine)
    }

    // A previously idle engine has been stopped; `go()` restarts it on demand,
    // but starting here keeps that cost off the first search.
    await engine.start()
    this.startSweeper()
    return engine
  }

  /** Mark an engine busy so a long search is never swept out from under itself. */
  touch(key: EngineKey): void {
    this.lastUsed.set(this.slotFor(key), Date.now())
  }

  private startSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => void this.sweep(), IDLE_SWEEP_MS)
    // The sweep timer must never hold the process open on its own.
    this.sweeper.unref?.()
  }

  private async sweep(): Promise<void> {
    const now = Date.now()
    for (const [slot, engine] of this.engines) {
      const idleFor = now - (this.lastUsed.get(slot) ?? 0)
      if (idleFor < IDLE_SHUTDOWN_MS) continue
      if (engine.isBusy()) continue
      await engine.stop()
    }
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    await Promise.all([...this.engines.values()].map((e) => e.stop()))
    this.engines.clear()
    this.lastUsed.clear()
  }
}

export { SF_MIN_ELO, SF_MAX_ELO, EMULATION_FLOOR }
export type { StrengthSpec }
