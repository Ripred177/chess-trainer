/**
 * Rebuilds the sampling tables on an existing puzzles.db.
 *
 * `build-puzzle-db.mjs` does this as its final step; this script exists so the
 * tables can be regenerated without re-reading the 300MB dump.
 *
 * Usage: node scripts/build-indexes.mjs
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAuxTables } from './lib/aux-tables.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'resources/puzzles.db')

const db = new DatabaseSync(OUT)
db.exec('PRAGMA journal_mode = OFF')
db.exec('PRAGMA synchronous = OFF')
db.exec('PRAGMA temp_store = MEMORY')
db.exec('PRAGMA cache_size = -262144')

console.log(`Building sampling tables in ${OUT}`)
buildAuxTables(db)
db.exec('PRAGMA optimize')
db.close()
