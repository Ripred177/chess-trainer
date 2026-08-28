import type { Puzzle, PuzzleQuery, PuzzleStats } from '@shared/types'

/**
 * Puzzle access for the web build.
 *
 * The desktop app queries 6.1M puzzles in SQLite. Here the data is a sampled
 * slice sharded into 200-point rating bands, so a request loads one ~450KB
 * band rather than a 3GB file. Bands are cached after first use, which is what
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

    // Try bands in a shuffled order so the same band is not always drained
    // first, then widen if a themed request cannot be satisfied.
    const order = [...bands]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }

    let loadedAny = false
    let lastError: unknown = null

    for (const band of order) {
      if (out.length >= limit) break

      // Offline, only the bands already in the cache will load. Skipping the
      // rest is the difference between "some puzzles" and none at all — and
      // since the order is shuffled, failing hard here made it a coin flip
      // whether any puzzles appeared.
      let puzzles: Puzzle[]
      try {
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
