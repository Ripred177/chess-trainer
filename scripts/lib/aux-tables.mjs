/**
 * Builds the sampling tables that make random puzzle selection instant.
 *
 * The naive query — filter by a rating *range* and `ORDER BY rnd LIMIT n` —
 * cannot use the (rating, rnd) index for ordering, because rnd is only sorted
 * within a single rating value. SQLite falls back to sorting every candidate in
 * a temp B-tree: ~62ms for a rating band, and nearly 15 seconds for the daily
 * puzzle's extra popularity filters.
 *
 * Constraining rating to a single *value* changes the plan to a pure index seek
 * (0.2-0.9ms). So instead of scanning a band, we first choose one rating inside
 * the band, then seek within it. To keep that uniform over puzzles rather than
 * over rating values, the choice is weighted by how many puzzles each rating
 * holds — which is what these cumulative-count tables provide.
 */

export const AUX_SCHEMA = `
DROP TABLE IF EXISTS rating_counts;
DROP TABLE IF EXISTS theme_rating_counts;
DROP TABLE IF EXISTS theme_counts;
DROP TABLE IF EXISTS daily_pool;

-- Puzzles per rating, with a running total for weighted sampling.
CREATE TABLE rating_counts (
  rating INTEGER NOT NULL PRIMARY KEY,
  n      INTEGER NOT NULL,
  cum    INTEGER NOT NULL
) STRICT;

-- The same, partitioned by theme.
CREATE TABLE theme_rating_counts (
  theme  TEXT    NOT NULL,
  rating INTEGER NOT NULL,
  n      INTEGER NOT NULL,
  cum    INTEGER NOT NULL,
  PRIMARY KEY (theme, rating)
) STRICT;

CREATE TABLE theme_counts (
  theme TEXT    NOT NULL PRIMARY KEY,
  n     INTEGER NOT NULL
) STRICT;

-- Pre-filtered daily candidates, numbered contiguously so picking one is a
-- primary-key lookup rather than a filtered scan.
CREATE TABLE daily_pool (
  n         INTEGER NOT NULL PRIMARY KEY,
  puzzle_id TEXT    NOT NULL
) STRICT;
`

export const AUX_INDEXES = `
CREATE INDEX idx_rating_counts_cum ON rating_counts(cum);
CREATE INDEX idx_theme_rating_cum  ON theme_rating_counts(theme, cum);
`

/**
 * Criteria for the daily puzzle: well-played and well-liked, in a rating band
 * that is a fair challenge for a typical player.
 */
const DAILY_FILTER = `rating BETWEEN 1200 AND 2200 AND popularity >= 90 AND nb_plays >= 1000`

export function buildAuxTables(db, log = console.log) {
  const started = Date.now()

  db.exec(AUX_SCHEMA)

  log('  rating_counts...')
  db.exec('BEGIN')
  const ratingRows = db.prepare('SELECT rating, COUNT(*) AS n FROM puzzles GROUP BY rating ORDER BY rating').all()
  const insertRating = db.prepare('INSERT INTO rating_counts (rating, n, cum) VALUES (?, ?, ?)')
  let cum = 0
  for (const row of ratingRows) {
    cum += row.n
    insertRating.run(row.rating, row.n, cum)
  }
  db.exec('COMMIT')
  log(`    ${ratingRows.length} distinct ratings, ${cum.toLocaleString('en-US')} puzzles`)

  log('  theme_rating_counts...')
  db.exec('BEGIN')
  const themeRows = db
    .prepare('SELECT theme, rating, COUNT(*) AS n FROM puzzle_themes GROUP BY theme, rating ORDER BY theme, rating')
    .all()
  const insertThemeRating = db.prepare(
    'INSERT INTO theme_rating_counts (theme, rating, n, cum) VALUES (?, ?, ?, ?)'
  )
  const totals = new Map()
  let currentTheme = null
  let themeCum = 0
  for (const row of themeRows) {
    if (row.theme !== currentTheme) {
      currentTheme = row.theme
      themeCum = 0
    }
    themeCum += row.n
    insertThemeRating.run(row.theme, row.rating, row.n, themeCum)
    totals.set(row.theme, themeCum)
  }
  db.exec('COMMIT')

  db.exec('BEGIN')
  const insertThemeCount = db.prepare('INSERT INTO theme_counts (theme, n) VALUES (?, ?)')
  for (const [theme, n] of totals) insertThemeCount.run(theme, n)
  db.exec('COMMIT')
  log(`    ${totals.size} themes, ${themeRows.length.toLocaleString('en-US')} theme/rating pairs`)

  log('  daily_pool...')
  db.exec('BEGIN')
  // rowid gives us the contiguous numbering for free.
  db.exec(
    `INSERT INTO daily_pool (n, puzzle_id)
     SELECT ROW_NUMBER() OVER (ORDER BY rnd), id FROM puzzles WHERE ${DAILY_FILTER}`
  )
  db.exec('COMMIT')
  const poolSize = db.prepare('SELECT COUNT(*) AS n FROM daily_pool').get().n
  log(`    ${poolSize.toLocaleString('en-US')} daily candidates`)

  log('  indexing...')
  db.exec(AUX_INDEXES)

  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  setMeta.run('daily_pool_size', String(poolSize))
  setMeta.run('theme_total', String(totals.size))
  setMeta.run('aux_built_at', new Date().toISOString())

  log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return { poolSize, themes: totals.size, ratings: ratingRows.length }
}
