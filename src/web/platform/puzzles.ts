import type { Puzzle, PuzzleQuery, PuzzleStats } from '@shared/types'

/**
 * Puzzle access for the web build.
 *
 * The desktop app queries 6.1M puzzles in SQLite. Here the data is a sampled
 * slice sharded into 50-point rating bands, so a request loads one ~1MB shard
 * rather than a 3GB file. Shards are cached after first use, which is what
 * makes the second puzzle in a session instant.
 */

interface PackedIndex {
  version: number
  total: number
  bandSize: number
  bands: { lo: number; hi: number; file: string; count: number }[]
  daily: { file: string; count: number }
  themes: { theme: string; count: number }[]
}

/**
 * How many shards one query may download. Shards are ~1MB gzipped, so this
 * bounds a single request at a few megabytes even when a rare motif forces
 * the search to widen.
 */
const MAX_FETCHES_PER_QUERY = 3

/**
 * Rating points of noise added when ranking shards by distance. Large enough
 * that neighbouring shards trade places between visits, small enough that the
 * search never wanders far from the requested range.
 */
const BAND_JITTER = 60

/** [id, fen, moves, rating, themes] — keys would triple the download. */
type PackedPuzzle = [string, string, string, number, string]

function unpack(row: PackedPuzzle): Puzzle {
  return {
    id: row[0],
    fen: row[1],
    moves: row[2].split(' ').filter(Boolean),
    rating: row[3],
    ratingDeviation: 75,
    popularity: 100,
    nbPlays: 0,
    themes: row[4] ? row[4].split(' ').filter(Boolean) : [],
    gameUrl: `https://lichess.org/training/${row[0]}`,
    openingTags: []
  }
}

/** xorshift32 — reproducible for a given seed, matching the desktop build. */
function seededRandom(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 0x100000000
  }
}

function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export class WebPuzzles {
  private index: PackedIndex | null = null
  private bands = new Map<string, Puzzle[]>()
  private daily: Puzzle[] | null = null
  private base: string

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`
  }

  private async loadIndex(): Promise<PackedIndex> {
    if (this.index) return this.index
    const res = await fetch(`${this.base}index.json`)
    if (!res.ok) throw new Error(`Puzzle index unavailable (HTTP ${res.status})`)
    this.index = (await res.json()) as PackedIndex
    return this.index
  }

  private async loadBand(file: string): Promise<Puzzle[]> {
    const cached = this.bands.get(file)
    if (cached) return cached
    const res = await fetch(`${this.base}${file}`)
    if (!res.ok) throw new Error(`Puzzle band unavailable (HTTP ${res.status})`)
    const rows = (await res.json()) as PackedPuzzle[]
    const puzzles = rows.map(unpack)
    this.bands.set(file, puzzles)
    return puzzles
  }

  async available(): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.loadIndex()
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async stats(): Promise<PuzzleStats> {
    const index = await this.loadIndex()
    return {
      total: index.total,
      minRating: index.bands[0]?.lo ?? 0,
      maxRating: index.bands.at(-1)?.hi ?? 0,
      themes: index.themes
    }
  }

  async byId(id: string): Promise<Puzzle | null> {
    // Only loaded bands can be searched; ids are not indexed across shards.
    for (const band of this.bands.values()) {
      const hit = band.find((p) => p.id === id)
      if (hit) return hit
    }
    if (this.daily) {
      const hit = this.daily.find((p) => p.id === id)
      if (hit) return hit
    }
    return null
  }

  async find(query: PuzzleQuery = {}): Promise<Puzzle[]> {
    const index = await this.loadIndex()
    const min = query.minRating ?? 0
    const max = query.maxRating ?? 4000
    const limit = Math.max(1, Math.min(query.limit ?? 1, 200))
    const rand = seededRandom(query.seed ?? (Math.random() * 0xffffffff) >>> 0)

    const bands = index.bands.filter((b) => b.hi > min && b.lo < max)
    if (bands.length === 0) return []

    const themes = query.themes?.filter(Boolean) ?? []
    const out: Puzzle[] = []
    const seen = new Set<string>()

    // Ordering matters more at 50-point shards than it did at 200: a wide or
    // narrowly-themed request could otherwise touch dozens of files. Take
    // already-loaded shards first (they are free), then those nearest the
    // middle of the requested range, so whatever does get downloaded is at the
    // player's level. The jitter stops equally-close shards from always
    // resolving the same way.
    const centre = (Math.max(min, 0) + Math.min(max, 4000)) / 2
    const order = [...bands].sort((a, b) => {
      const loaded = Number(this.bands.has(b.file)) - Number(this.bands.has(a.file))
      if (loaded !== 0) return loaded
      const da = Math.abs((a.lo + a.hi) / 2 - centre) + rand() * BAND_JITTER
      const db = Math.abs((b.lo + b.hi) / 2 - centre) + rand() * BAND_JITTER
      return da - db
    })

    let loadedAny = false
    let lastError: unknown = null
    let fetches = 0

    for (const band of order) {
      if (out.length >= limit) break

      // Cap what a single request may pull over the network. An uncommon motif
      // may genuinely not appear in the nearest shards, and walking all 48 to
      // prove it would cost well over a hundred megabytes. Returning fewer
      // puzzles is the better failure.
      const cached = this.bands.has(band.file)
      if (!cached && fetches >= MAX_FETCHES_PER_QUERY && out.length > 0) break

      // Offline, only the bands already in the cache will load. Skipping the
      // rest is the difference between "some puzzles" and none at all — and
      // since the order was shuffled, failing hard here made it a coin flip
      // whether any puzzles appeared.
      let puzzles: Puzzle[]
      try {
        if (!cached) fetches++
        puzzles = await this.loadBand(band.file)
        loadedAny = true
      } catch (err) {
        lastError = err
        continue
      }

      const matching = puzzles.filter((p) => {
        if (p.rating < min || p.rating > max) return false
        if (themes.length === 0) return true
        const has = new Set(p.themes)
        return query.matchAll ? themes.every((t) => has.has(t)) : themes.some((t) => has.has(t))
      })

      // Start at a random offset so repeat visits do not replay the same set.
      const start = matching.length > 0 ? Math.floor(rand() * matching.length) : 0
      for (let i = 0; i < matching.length && out.length < limit; i++) {
        const p = matching[(start + i) % matching.length]
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
      }
    }

    // Nothing loaded at all is a genuine failure worth reporting; a partial
    // result is not.
    if (!loadedAny && lastError) throw lastError
    return out
  }

  /**
   * Fetches every band so the whole puzzle set is available offline.
   *
   * Bands are requested one at a time rather than in parallel: the point is to
   * fill the service worker's cache, and a phone on a slow connection handles
   * a queue of 1.3MB requests far better than twelve at once.
   */
  async downloadAll(onProgress?: (done: number, total: number, label: string) => void): Promise<void> {
    const index = await this.loadIndex()
    const files = [...index.bands.map((b) => b.file), index.daily.file]

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      onProgress?.(i, files.length, file)
      if (file === index.daily.file) {
        await this.loadDaily()
      } else {
        await this.loadBand(file)
      }
    }
    onProgress?.(files.length, files.length, 'done')
  }

  /** How much of the puzzle set is already cached, for the Settings screen. */
  async cacheStatus(): Promise<{ ready: number; total: number; bytes: number }> {
    const index = await this.loadIndex()
    const files = [...index.bands.map((b) => b.file), index.daily.file]

    if (typeof caches === 'undefined') {
      return { ready: this.bands.size + (this.daily ? 1 : 0), total: files.length, bytes: 0 }
    }

    let ready = 0
    let bytes = 0
    for (const file of files) {
      const hit = await caches.match(`${this.base}${file}`)
      if (!hit) continue
      ready++
      const length = Number(hit.headers.get('content-length') ?? 0)
      if (Number.isFinite(length)) bytes += length
    }
    return { ready, total: files.length, bytes }
  }

  private async loadDaily(): Promise<Puzzle[]> {
    if (this.daily) return this.daily
    const index = await this.loadIndex()
    const res = await fetch(`${this.base}${index.daily.file}`)
    if (!res.ok) throw new Error(`Daily pool unavailable (HTTP ${res.status})`)
    this.daily = ((await res.json()) as PackedPuzzle[]).map(unpack)
    return this.daily
  }

  async dailyPuzzle(date: string): Promise<Puzzle | null> {
    try {
      await this.loadDaily()
    } catch {
      return null
    }
    if (!this.daily || this.daily.length === 0) return null
    // Seeded purely by the date, so every device sees the same puzzle.
    return this.daily[hashString(`daily:${date}`) % this.daily.length]
  }
}
