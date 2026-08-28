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
db.exec('PRAGMA journal_mode = WAL')
const result = buildOpeningIndex(db)
db.exec('PRAGMA optimize')
db.close()

const after = statSync(DB).size
console.log(
  `\n${result.openings} openings indexed; database grew ` +
    `${((after - before) / 1e6).toFixed(0)}MB to ${(after / 1e9).toFixed(2)}GB`
)
