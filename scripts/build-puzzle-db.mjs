/**
 * Builds the puzzle SQLite database from the Lichess open puzzle dump.
 *
 * Input :  assets/raw/lichess_db_puzzle.csv.zst   (CC0, database.lichess.org)
 * Output:  resources/puzzles.db
 *
 * The dump is ~5M rows. We stream it through the frame-aware zstd reader
 * straight into SQLite so the 1.1GB of decompressed CSV never hits disk.
 *
 * Random access is the whole game here: "give me a random 1500-rated fork
 * puzzle" must be instant. Sorting 5M rows by RANDOM() is not, so every row
 * gets a fixed random key `rnd` and queries seek into (rating, rnd) instead.
 *
 * Usage: node scripts/build-puzzle-db.mjs [--limit N] [--force]
 */

import { mkdir, stat, unlink } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { createDumpStream } from './lib/zstd-frames.mjs'
import { buildAuxTables } from './lib/aux-tables.mjs'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(root, 'assets/raw/lichess_db_puzzle.csv.zst')
const OUT = resolve(root, 'resources/puzzles.db')

const args = process.argv.slice(2)
const limitArg = args.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity
const FORCE = args.includes('--force')

/** Column count of the upstream CSV; a change here means the format moved. */
const COLUMNS = 11

const SCHEMA = `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -262144;

CREATE TABLE puzzles (
  id           TEXT    NOT NULL PRIMARY KEY,
  fen          TEXT    NOT NULL,
  moves        TEXT    NOT NULL,
  rating       INTEGER NOT NULL,
  rd           INTEGER NOT NULL,
  popularity   INTEGER NOT NULL,
  nb_plays     INTEGER NOT NULL,
  themes       TEXT    NOT NULL,
  game_url     TEXT    NOT NULL,
  opening_tags TEXT    NOT NULL,
  -- Non-empty when Lichess featured this puzzle as its puzzle of the day.
  daily_date   TEXT    NOT NULL,
  rnd          INTEGER NOT NULL
) STRICT;

-- One row per (puzzle, theme). Wide enough to answer themed queries without
-- touching the puzzles table until we know which ids we want.
CREATE TABLE puzzle_themes (
  theme     TEXT    NOT NULL,
  rating    INTEGER NOT NULL,
  rnd       INTEGER NOT NULL,
  puzzle_id TEXT    NOT NULL
) STRICT;

CREATE TABLE meta (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`

const INDEXES = `
CREATE INDEX idx_puzzles_rating_rnd ON puzzles(rating, rnd);
CREATE INDEX idx_puzzles_popularity ON puzzles(popularity);
CREATE INDEX idx_themes_lookup      ON puzzle_themes(theme, rating, rnd, puzzle_id);
CREATE INDEX idx_puzzles_daily      ON puzzles(daily_date) WHERE daily_date <> '';
`

/**
 * Deterministic 32-bit hash of the puzzle id, used as the random sort key.
 * Deriving it from the id rather than Math.random() keeps rebuilds reproducible,
 * so a "random" puzzle for a given seed is the same across machines.
 */
function hashKey(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2_000_000_000
}

function fmt(n) {
  return n.toLocaleString('en-US')
}

async function main() {
  try {
    await stat(SRC)
  } catch {
    console.error(`Missing ${SRC}\nDownload it first:\n  curl -L -o assets/raw/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst`)
    process.exit(1)
  }

  await mkdir(dirname(OUT), { recursive: true })
  try {
    await stat(OUT)
    if (!FORCE) {
      console.error(`${OUT} already exists. Re-run with --force to rebuild.`)
      process.exit(1)
    }
    await unlink(OUT)
  } catch {
    /* no existing database, which is the normal case */
  }

  const db = new DatabaseSync(OUT)
  db.exec(SCHEMA)

  const insertPuzzle = db.prepare(
    `INSERT OR IGNORE INTO puzzles
       (id, fen, moves, rating, rd, popularity, nb_plays, themes, game_url, opening_tags, daily_date, rnd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertTheme = db.prepare(
    `INSERT INTO puzzle_themes (theme, rating, rnd, puzzle_id) VALUES (?, ?, ?, ?)`
  )

  const stream = createDumpStream(SRC)
  // Without this, a decoder failure would quietly end the loop and leave us
  // with an empty database instead of an error.
  let streamError = null
  stream.on('error', (err) => {
    streamError = err
  })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  let rows = 0
  let themeRows = 0
  let skipped = 0
  let header = true
  const started = Date.now()

  db.exec('BEGIN')

  for await (const line of rl) {
    if (header) {
      header = false
      // Sanity-check the column order rather than trusting it blindly.
      const cols = line.split(',')
      const expected =
        'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate'
      if (line.trim() !== expected) {
        console.warn(`! Unexpected header, parsing may be wrong.\n  got:      ${line}\n  expected: ${expected}`)
      }
      if (cols.length !== COLUMNS) {
        db.exec('ROLLBACK')
        throw new Error(`Expected ${COLUMNS} columns, found ${cols.length}`)
      }
      continue
    }

    if (!line) continue

    const f = line.split(',')
    // No field in this dump is quoted or contains a comma; a row that splits
    // into the wrong shape is corrupt rather than merely unusual.
    if (f.length !== COLUMNS) {
      skipped++
      continue
    }

    const [id, fen, moves, rating, rd, popularity, nbPlays, themes, gameUrl, openingTags, dailyDate] = f
    const r = Number(rating)
    if (!id || !fen || !moves || !Number.isFinite(r)) {
      skipped++
      continue
    }

    const rnd = hashKey(id)
    insertPuzzle.run(
      id, fen, moves, r,
      Number(rd) || 0, Number(popularity) || 0, Number(nbPlays) || 0,
      themes, gameUrl, openingTags, dailyDate ?? '', rnd
    )

    if (themes) {
      for (const theme of themes.split(' ')) {
        if (!theme) continue
        insertTheme.run(theme, r, rnd, id)
        themeRows++
      }
    }

    rows++
    if (rows % 250_000 === 0) {
      db.exec('COMMIT')
      db.exec('BEGIN')
      const secs = (Date.now() - started) / 1000
      process.stdout.write(`  ${fmt(rows)} puzzles  (${fmt(Math.round(rows / secs))}/s)\n`)
    }
    if (rows >= LIMIT) break
  }

  db.exec('COMMIT')
  rl.close()
  stream.destroy()

  if (streamError) throw streamError
  if (rows === 0) throw new Error('No rows were read — the input file may be truncated or corrupt.')

  console.log(`\nIndexing ${fmt(rows)} puzzles / ${fmt(themeRows)} theme rows...`)
  db.exec(INDEXES)

  const range = db.prepare('SELECT MIN(rating) lo, MAX(rating) hi FROM puzzles').get()
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  setMeta.run('source', 'https://database.lichess.org/lichess_db_puzzle.csv.zst')
  setMeta.run('license', 'CC0 1.0 Universal')
  setMeta.run('built_at', new Date().toISOString())
  setMeta.run('puzzle_count', String(rows))
  setMeta.run('min_rating', String(range.lo))
  setMeta.run('max_rating', String(range.hi))

  console.log('Building sampling tables...')
  buildAuxTables(db)

  console.log('Optimizing...')
  db.exec('PRAGMA optimize')
  db.close()

  const { size } = await stat(OUT)
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nDone in ${secs}s`)
  console.log(`  ${fmt(rows)} puzzles, ratings ${range.lo}-${range.hi}`)
  console.log(`  ${fmt(skipped)} malformed rows skipped`)
  console.log(`  ${OUT}  (${(size / 1e9).toFixed(2)} GB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
