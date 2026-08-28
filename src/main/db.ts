import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import type { Puzzle, PuzzleQuery, PuzzleStats, OpeningSummary } from '../shared/types.js'

interface PuzzleRow {
  id: string
  fen: string
  moves: string
  rating: number
  rd: number
  popularity: number
  nb_plays: number
  themes: string
  game_url: string
  opening_tags: string
  daily_date: string
  rnd: number
}

/** Matches the `rnd` key space produced by scripts/build-puzzle-db.mjs. */
const RND_SPACE = 2_000_000_000

/**
 * Safety valve for the sampling loop. Each pass picks one rating and seeks
 * within it; without a cap, a pathological query (a theme with almost nothing
 * in the requested band) could spin.
 */
const MAX_SAMPLE_PASSES = 24

function toPuzzle(row: PuzzleRow): Puzzle {
  return {
    id: row.id,
    fen: row.fen,
    moves: row.moves.split(' ').filter(Boolean),
    rating: row.rating,
    ratingDeviation: row.rd,
    popularity: row.popularity,
    nbPlays: row.nb_plays,
    themes: row.themes ? row.themes.split(' ').filter(Boolean) : [],
    gameUrl: row.game_url,
    openingTags: row.opening_tags ? row.opening_tags.split(' ').filter(Boolean) : []
  }
}

/** xorshift32 — small, fast, and reproducible across runs for a given seed. */
function seededRandom(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 0x100000000
  }
}

/** Stable hash so a given date always resolves to the same daily puzzle. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Read-only access to the bundled Lichess puzzle database.
 *
 * Selection works in two steps, and the split is deliberate. Filtering on a
 * rating *range* and ordering by the random key forces SQLite to sort every
 * matching row — tens of milliseconds over six million puzzles, and far worse
 * once popularity filters are added. Pinning rating to a single value instead
 * turns the same work into an index seek.
 *
 * So we first pick one rating from inside the requested band — weighted by the
 * precomputed puzzle counts, so the result is still uniform across puzzles —
 * and then seek into the (rating, rnd) index at a random offset, wrapping
 * around if we reach the end. Both steps are sub-millisecond.
 */
export class PuzzleDb {
  private db: DatabaseSync
  private stmts: Record<string, StatementSync> = {}
  private dailyPoolSize = 0

  constructor(private path: string) {
    if (!existsSync(path)) {
      throw new Error(`Puzzle database not found at ${path}. Build it with: npm run puzzles:build`)
    }
    this.db = new DatabaseSync(path, { readOnly: true })
    // 16MB. Every query is an index seek into a handful of pages, so a larger
    // cache only holds pages that are never read twice.
    this.db.exec('PRAGMA cache_size = -16384')
    this.assertSchema()
    this.prepare()
    this.dailyPoolSize = Number(this.meta().daily_pool_size ?? 0)
  }

  /** Fail loudly at startup rather than mid-query if the aux tables are absent. */
  private assertSchema(): void {
    const required = ['puzzles', 'puzzle_themes', 'rating_counts', 'theme_rating_counts', 'daily_pool']
    const present = new Set(
      (
        this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as {
          name: string
        }[]
      ).map((r) => r.name)
    )
    const missing = required.filter((t) => !present.has(t))
    if (missing.length > 0) {
      throw new Error(
        `Puzzle database is missing tables: ${missing.join(', ')}. Run: node scripts/build-indexes.mjs`
      )
    }
  }

  private prepare(): void {
    this.stmts.byId = this.db.prepare('SELECT * FROM puzzles WHERE id = ?')

    // --- weighted rating selection -----------------------------------------
    this.stmts.cumBelow = this.db.prepare(
      'SELECT COALESCE(MAX(cum), 0) AS cum FROM rating_counts WHERE rating < ?'
    )
    this.stmts.cumUpTo = this.db.prepare(
      'SELECT COALESCE(MAX(cum), 0) AS cum FROM rating_counts WHERE rating <= ?'
    )
    this.stmts.ratingAtCum = this.db.prepare(
      'SELECT rating FROM rating_counts WHERE cum >= ? ORDER BY cum LIMIT 1'
    )

    this.stmts.themeCumBelow = this.db.prepare(
      'SELECT COALESCE(MAX(cum), 0) AS cum FROM theme_rating_counts WHERE theme = ? AND rating < ?'
    )
    this.stmts.themeCumUpTo = this.db.prepare(
      'SELECT COALESCE(MAX(cum), 0) AS cum FROM theme_rating_counts WHERE theme = ? AND rating <= ?'
    )
    this.stmts.themeRatingAtCum = this.db.prepare(
      'SELECT rating FROM theme_rating_counts WHERE theme = ? AND cum >= ? ORDER BY cum LIMIT 1'
    )

    // --- seeks within one rating -------------------------------------------
    this.stmts.seek = this.db.prepare(
      'SELECT * FROM puzzles WHERE rating = ? AND rnd >= ? ORDER BY rnd LIMIT ?'
    )
    this.stmts.seekWrap = this.db.prepare(
      'SELECT * FROM puzzles WHERE rating = ? AND rnd < ? ORDER BY rnd LIMIT ?'
    )
    this.stmts.themeSeek = this.db.prepare(
      'SELECT puzzle_id FROM puzzle_themes WHERE theme = ? AND rating = ? AND rnd >= ? ORDER BY rnd LIMIT ?'
    )
    this.stmts.themeSeekWrap = this.db.prepare(
      'SELECT puzzle_id FROM puzzle_themes WHERE theme = ? AND rating = ? AND rnd < ? ORDER BY rnd LIMIT ?'
    )

    // --- daily and stats ----------------------------------------------------
    this.stmts.dailyAt = this.db.prepare(
      'SELECT p.* FROM daily_pool d JOIN puzzles p ON p.id = d.puzzle_id WHERE d.n = ?'
    )
    // --- openings -----------------------------------------------------------
    // A rating *range* plus ORDER BY rnd cannot use the index for ordering, so
    // this sorts in a temp B-tree — but only over one opening's rows, which is
    // a few thousand even for the Sicilian. Measured well under a millisecond.
    this.stmts.openingSeek = this.db.prepare(
      `SELECT puzzle_id FROM puzzle_openings
         WHERE opening = ? AND rating BETWEEN ? AND ? AND rnd >= ?
         ORDER BY rnd LIMIT ?`
    )
    this.stmts.openingSeekWrap = this.db.prepare(
      `SELECT puzzle_id FROM puzzle_openings
         WHERE opening = ? AND rating BETWEEN ? AND ? AND rnd < ?
         ORDER BY rnd LIMIT ?`
    )
    this.stmts.openingList = this.db.prepare(
      'SELECT opening, family, is_family, n FROM opening_counts ORDER BY n DESC'
    )

    this.stmts.themeCounts = this.db.prepare(
      'SELECT theme, n AS count FROM theme_counts ORDER BY n DESC'
    )
    this.stmts.themeTotal = this.db.prepare('SELECT n FROM theme_counts WHERE theme = ?')
    this.stmts.meta = this.db.prepare('SELECT key, value FROM meta')
  }

  private meta(): Record<string, string> {
    return Object.fromEntries(
      (this.stmts.meta.all() as unknown as { key: string; value: string }[]).map((r) => [r.key, r.value])
    )
  }

  getById(id: string): Puzzle | null {
    const row = this.stmts.byId.get(id) as PuzzleRow | undefined
    return row ? toPuzzle(row) : null
  }

  /**
   * Choose one rating inside [min, max], weighted by how many puzzles sit at
   * each rating. Returns null when the band holds nothing.
   */
  private pickRating(min: number, max: number, rand: () => number): number | null {
    const base = (this.stmts.cumBelow.get(min) as { cum: number }).cum
    const top = (this.stmts.cumUpTo.get(max) as { cum: number }).cum
    const total = top - base
    if (total <= 0) return null
    const target = base + Math.floor(rand() * total) + 1
    const row = this.stmts.ratingAtCum.get(target) as { rating: number } | undefined
    return row?.rating ?? null
  }

  private pickThemeRating(theme: string, min: number, max: number, rand: () => number): number | null {
    const base = (this.stmts.themeCumBelow.get(theme, min) as { cum: number }).cum
    const top = (this.stmts.themeCumUpTo.get(theme, max) as { cum: number }).cum
    const total = top - base
    if (total <= 0) return null
    const target = base + Math.floor(rand() * total) + 1
    const row = this.stmts.themeRatingAtCum.get(theme, target) as { rating: number } | undefined
    return row?.rating ?? null
  }

  /**
   * Fetch puzzles matching `query`.
   *
   * Passing the same seed reproduces the same set exactly, which is what lets
   * the daily puzzle and lesson practice sets be stable across sessions.
   */
  find(query: PuzzleQuery = {}): Puzzle[] {
    const min = query.minRating ?? 0
    const max = query.maxRating ?? 4000
    const limit = Math.max(1, Math.min(query.limit ?? 1, 500))
    const rand = seededRandom(query.seed ?? (Math.random() * 0xffffffff) >>> 0)

    const themes = query.themes?.filter(Boolean) ?? []

    if (query.opening) {
      // Over-fetch when themes will thin the result: an uncommon motif inside one
      // opening is sparse, and limit*3 was returning half the puzzles asked for.
      const overFetch = themes.length > 0 ? 12 : 3
      const ids = this.sampleOpeningIds(query.opening, min, max, limit * overFetch, rand)
      const puzzles = this.hydrate(ids)
      // Themes narrow an opening rather than the other way round: there is no
      // combined index, and an opening's slice is small enough to filter here.
      const filtered =
        themes.length === 0
          ? puzzles
          : puzzles.filter((puzzle) => {
              const has = new Set(puzzle.themes)
              return query.matchAll
                ? themes.every((t) => has.has(t))
                : themes.some((t) => has.has(t))
            })
      return filtered.slice(0, limit)
    }

    if (themes.length === 0) return this.sampleByRating(min, max, limit, rand)
    if (themes.length === 1 && !query.matchAll) {
      return this.hydrate(this.sampleThemeIds(themes[0], min, max, limit, rand))
    }
    if (query.matchAll) return this.sampleAllThemes(themes, min, max, limit, rand)

    // Any-of: draw from each theme in turn so no single one dominates.
    const seen = new Set<string>()
    const ids: string[] = []
    const perTheme = Math.max(1, Math.ceil(limit / themes.length))
    for (const theme of themes) {
      for (const id of this.sampleThemeIds(theme, min, max, perTheme, rand)) {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
    }
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    return this.hydrate(ids.slice(0, limit))
  }

  private sampleByRating(min: number, max: number, limit: number, rand: () => number): Puzzle[] {
    const out: PuzzleRow[] = []
    const seen = new Set<string>()

    for (let pass = 0; pass < MAX_SAMPLE_PASSES && out.length < limit; pass++) {
      const rating = this.pickRating(min, max, rand)
      if (rating == null) break

      const cursor = Math.floor(rand() * RND_SPACE)
      const want = limit - out.length
      const rows = this.stmts.seek.all(rating, cursor, want) as unknown as PuzzleRow[]
      const wrapped =
        rows.length < want
          ? (this.stmts.seekWrap.all(rating, cursor, want - rows.length) as unknown as PuzzleRow[])
          : []

      for (const row of [...rows, ...wrapped]) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        out.push(row)
        if (out.length >= limit) break
      }
    }

    return out.map(toPuzzle)
  }

  /** Openings have no per-rating cumulative table; the slice is small enough
   *  that a direct seek from a random cursor is both simpler and fast. */
  private sampleOpeningIds(
    opening: string,
    min: number,
    max: number,
    limit: number,
    rand: () => number
  ): string[] {
    const cursor = Math.floor(rand() * RND_SPACE)
    const rows = this.stmts.openingSeek.all(opening, min, max, cursor, limit) as unknown as {
      puzzle_id: string
    }[]
    const wrapped =
      rows.length < limit
        ? (this.stmts.openingSeekWrap.all(
            opening,
            min,
            max,
            cursor,
            limit - rows.length
          ) as unknown as { puzzle_id: string }[])
        : []

    const seen = new Set<string>()
    const ids: string[] = []
    for (const row of [...rows, ...wrapped]) {
      if (seen.has(row.puzzle_id)) continue
      seen.add(row.puzzle_id)
      ids.push(row.puzzle_id)
    }
    return ids
  }

  /** Every indexed opening, biggest first, for the opening picker. */
  openings(): OpeningSummary[] {
    const rows = this.stmts.openingList.all() as unknown as {
      opening: string
      family: string
      is_family: number
      n: number
    }[]
    return rows.map((r) => ({
      id: r.opening,
      name: r.opening.replace(/_/g, ' '),
      family: r.family.replace(/_/g, ' '),
      isFamily: r.is_family === 1,
      count: r.n
    }))
  }

  private sampleThemeIds(
    theme: string,
    min: number,
    max: number,
    limit: number,
    rand: () => number
  ): string[] {
    const ids: string[] = []
    const seen = new Set<string>()

    for (let pass = 0; pass < MAX_SAMPLE_PASSES && ids.length < limit; pass++) {
      const rating = this.pickThemeRating(theme, min, max, rand)
      if (rating == null) break

      const cursor = Math.floor(rand() * RND_SPACE)
      const want = limit - ids.length
      const rows = this.stmts.themeSeek.all(theme, rating, cursor, want) as unknown as {
        puzzle_id: string
      }[]
      const wrapped =
        rows.length < want
          ? (this.stmts.themeSeekWrap.all(theme, rating, cursor, want - rows.length) as unknown as {
              puzzle_id: string
            }[])
          : []

      for (const row of [...rows, ...wrapped]) {
        if (seen.has(row.puzzle_id)) continue
        seen.add(row.puzzle_id)
        ids.push(row.puzzle_id)
        if (ids.length >= limit) break
      }
    }

    return ids
  }

  /**
   * Puzzles carrying *every* listed theme.
   *
   * Driven by whichever theme is rarest, since that is the cheapest set to
   * enumerate; the remaining themes are checked against each candidate's own
   * theme list rather than with a join.
   */
  private sampleAllThemes(
    themes: string[],
    min: number,
    max: number,
    limit: number,
    rand: () => number
  ): Puzzle[] {
    const counts = themes.map((theme) => ({
      theme,
      n: (this.stmts.themeTotal.get(theme) as { n: number } | undefined)?.n ?? 0
    }))
    counts.sort((a, b) => a.n - b.n)
    const driver = counts[0]
    if (!driver || driver.n === 0) return []

    const required = new Set(themes)
    const out: Puzzle[] = []
    const seen = new Set<string>()

    // Over-fetch, because most candidates will miss at least one theme.
    for (let pass = 0; pass < MAX_SAMPLE_PASSES && out.length < limit; pass++) {
      const ids = this.sampleThemeIds(driver.theme, min, max, limit * 8, rand)
      if (ids.length === 0) break

      for (const puzzle of this.hydrate(ids)) {
        if (seen.has(puzzle.id)) continue
        seen.add(puzzle.id)
        const has = new Set(puzzle.themes)
        if ([...required].every((t) => has.has(t))) {
          out.push(puzzle)
          if (out.length >= limit) break
        }
      }
    }

    return out
  }

  /** Look ids up in bulk, preserving the order they were selected in. */
  private hydrate(ids: string[]): Puzzle[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM puzzles WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as PuzzleRow[]
    const byId = new Map(rows.map((r) => [r.id, toPuzzle(r)]))
    return ids.map((id) => byId.get(id)).filter((p): p is Puzzle => p != null)
  }

  /**
   * The puzzle of the day for a local calendar date.
   *
   * Drawn from a pre-filtered pool of well-played, well-liked puzzles and
   * seeded purely by the date string, so every install sees the same puzzle
   * with no server involved.
   */
  daily(date: string): Puzzle | null {
    if (this.dailyPoolSize <= 0) return null
    const n = (hashString(`daily:${date}`) % this.dailyPoolSize) + 1
    const row = this.stmts.dailyAt.get(n) as PuzzleRow | undefined
    return row ? toPuzzle(row) : null
  }

  stats(): PuzzleStats {
    const meta = this.meta()
    const themes = this.stmts.themeCounts.all() as unknown as { theme: string; count: number }[]
    return {
      total: Number(meta.puzzle_count ?? 0),
      minRating: Number(meta.min_rating ?? 0),
      maxRating: Number(meta.max_rating ?? 0),
      themes
    }
  }

  close(): void {
    this.db.close()
  }

  get filePath(): string {
    return this.path
  }
}
