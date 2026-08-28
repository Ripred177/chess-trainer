/**
 * Adds the opening lookup tables to an existing puzzle database.
 *
 * Separate from the main builder so this does not require re-reading the 3GB
 * dump. A full `npm run puzzles:build` includes it too.
 *
 * Usage: npm run puzzles:openings
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { buildOpeningIndex } from './lib/opening-index.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DB = resolve(root, 'resources/puzzles.db')

try {
  statSync(DB)
} catch {
  console.error(`Missing ${DB}. Build it first with: npm run puzzles:build`)
  process.exit(1)
}

const before = statSync(DB).size
console.log(`Indexing openings in ${DB}`)

const db = new DatabaseSync(DB)
// WAL while writing, so a crash part-way through cannot corrupt a database
// that took hours to build. But the mode is recorded in the file header, and
// a WAL database cannot be opened from a read-only install directory — which
// is exactly where the packaged app puts it. Reset before closing.
db.exec('PRAGMA journal_mode = WAL')
const result = buildOpeningIndex(db)
db.exec('PRAGMA optimize')
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.exec('PRAGMA journal_mode = DELETE')
db.close()

const after = statSync(DB).size
console.log(
  `\n${result.openings} openings indexed; database grew ` +
    `${((after - before) / 1e6).toFixed(0)}MB to ${(after / 1e9).toFixed(2)}GB`
)
