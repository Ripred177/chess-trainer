/**
 * Builds the opening lookup tables.
 *
 * Lichess tags roughly 1.2M puzzles with the opening the game came from, as a
 * space-separated pair: a family ("Sicilian_Defense") and a specific variation
 * ("Sicilian_Defense_Najdorf_Variation"). Both are useful — you want to train
 * the Najdorf specifically, or the whole Sicilian.
 *
 * The tags live in one text column, so answering "puzzles from the Najdorf near
 * rating 1600" would mean a LIKE scan over six million rows. This flattens them
 * into the same shape as puzzle_themes, whose (key, rating, rnd, id) index
 * turns that question into a seek.
 *
 * Openings are stored twice per puzzle — once under the family, once under the
 * variation — which is what lets a single query serve either granularity.
 */

export const OPENING_SCHEMA = `
DROP TABLE IF EXISTS puzzle_openings;
DROP TABLE IF EXISTS opening_counts;

CREATE TABLE puzzle_openings (
  opening   TEXT    NOT NULL,
  rating    INTEGER NOT NULL,
  rnd       INTEGER NOT NULL,
  puzzle_id TEXT    NOT NULL
) STRICT;

CREATE TABLE opening_counts (
  opening TEXT    NOT NULL PRIMARY KEY,
  -- The family this belongs to; equal to the opening for a family row itself.
  family  TEXT    NOT NULL,
  -- 1 when this row is a family rather than a specific variation.
  is_family INTEGER NOT NULL,
  n       INTEGER NOT NULL
) STRICT;
`

export const OPENING_INDEXES = `
CREATE INDEX idx_openings_lookup ON puzzle_openings(opening, rating, rnd, puzzle_id);
CREATE INDEX idx_opening_counts_family ON opening_counts(family, n);
`

/**
 * A tag list is "Family Family_Variation_Name". The first token is the family;
 * anything else is a variation belonging to it. Guarding on prefix rather than
 * position keeps it correct when a puzzle carries only one of the two.
 */
function splitTags(tags) {
  const parts = tags.split(' ').filter(Boolean)
  if (parts.length === 0) return []
  const family = parts[0]
  return parts.map((opening) => ({ opening, family, isFamily: opening === family }))
}

export function buildOpeningIndex(db, log = console.log) {
  const started = Date.now()

  db.exec(OPENING_SCHEMA)

  log('  puzzle_openings...')
  const rows = db.prepare(
    `SELECT id, rating, rnd, opening_tags FROM puzzles WHERE opening_tags <> ''`
  )

  const insert = db.prepare(
    'INSERT INTO puzzle_openings (opening, rating, rnd, puzzle_id) VALUES (?, ?, ?, ?)'
  )
  const counts = new Map()

  db.exec('BEGIN')
  let tagged = 0
  let pairs = 0
  for (const row of rows.iterate()) {
    tagged++
    for (const { opening, family, isFamily } of splitTags(row.opening_tags)) {
      insert.run(opening, row.rating, row.rnd, row.id)
      pairs++
      const existing = counts.get(opening)
      if (existing) existing.n++
      else counts.set(opening, { family, isFamily: isFamily ? 1 : 0, n: 1 })
    }
  }
  db.exec('COMMIT')
  log(`    ${tagged.toLocaleString('en-US')} tagged puzzles, ${pairs.toLocaleString('en-US')} rows`)

  log('  opening_counts...')
  db.exec('BEGIN')
  const insertCount = db.prepare(
    'INSERT INTO opening_counts (opening, family, is_family, n) VALUES (?, ?, ?, ?)'
  )
  for (const [opening, v] of counts) insertCount.run(opening, v.family, v.isFamily, v.n)
  db.exec('COMMIT')

  const families = [...counts.values()].filter((v) => v.isFamily === 1).length
  log(`    ${counts.size.toLocaleString('en-US')} openings (${families} families)`)

  log('  indexing...')
  db.exec(OPENING_INDEXES)

  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  setMeta.run('opening_total', String(counts.size))
  setMeta.run('opening_built_at', new Date().toISOString())

  log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return { openings: counts.size, families, pairs }
}
