/**
 * Exports a phone-sized slice of the puzzle database for the web build.
 *
 * The desktop app carries all 6.1M puzzles in a 3.1GB SQLite file, which is
 * obviously not going on a phone. Puzzles compress extremely well in a compact
 * array form — about 129 bytes each — so a hundred thousand of them costs
 * roughly 4MB gzipped, which is entirely reasonable to cache offline.
 *
 * Puzzles are sharded by rating band so the app loads only the band it needs.
 * Themed filtering then happens inside the loaded band, which is why each band
 * carries enough puzzles for even uncommon motifs to appear.
 *
 * Output: src/web/public/puzzles/{index,band-*,daily}.json
 * Usage:  node scripts/build-web-puzzles.mjs [--per-band 9000]
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DB = resolve(root, 'resources/puzzles.db')
const OUT = resolve(root, 'src/web/public/puzzles')

const args = process.argv.slice(2)
const perBandArg = args.indexOf('--per-band')
const PER_BAND = perBandArg >= 0 ? Number(args[perBandArg + 1]) : 9000

/** 200-point bands from beginner to master. */
const BAND_SIZE = 200
const MIN_RATING = 400
const MAX_RATING = 2800

/** Puzzles in the daily pool; one per day, so this lasts several years. */
const DAILY_POOL = 2000

/**
 * Rows are stored as arrays rather than objects. The keys would otherwise be
 * repeated for every puzzle and roughly triple the download.
 */
function pack(row) {
  return [row.id, row.fen, row.moves, row.rating, row.themes]
}

async function main() {
  await stat(DB).catch(() => {
    console.error(`Missing ${DB}. Build it first with: npm run puzzles:build`)
    process.exit(1)
  })

  const db = new DatabaseSync(DB, { readOnly: true })
  await mkdir(OUT, { recursive: true })

  // Spread the selection across the whole `rnd` key space rather than taking
  // the first N rows, so each band is a fair sample rather than a slice.
  const select = db.prepare(
    `SELECT id, fen, moves, rating, themes
       FROM puzzles
      WHERE rating >= ? AND rating < ?
      ORDER BY rnd
      LIMIT ?`
  )

  const bands = []
  let total = 0

  for (let lo = MIN_RATING; lo < MAX_RATING; lo += BAND_SIZE) {
    const hi = lo + BAND_SIZE
    const rows = select.all(lo, hi, PER_BAND)
    if (rows.length === 0) continue

    const name = `band-${lo}-${hi}.json`
    const body = JSON.stringify(rows.map(pack))
    await writeFile(join(OUT, name), body, 'utf8')

    bands.push({ lo, hi, file: name, count: rows.length })
    total += rows.length
    console.log(
      `  ${String(lo).padStart(4)}-${String(hi).padEnd(4)}  ${String(rows.length).padStart(6)} puzzles  ` +
        `${(body.length / 1e6).toFixed(2)}MB raw  ${(gzipSync(body).length / 1e6).toFixed(2)}MB gzipped`
    )
  }

  // The daily puzzle must be identical on every device, so it is drawn from a
  // fixed, ordered pool indexed by date rather than sampled at random.
  const daily = db
    .prepare(
      `SELECT id, fen, moves, rating, themes
         FROM puzzles
        WHERE rating BETWEEN 1200 AND 2200
          AND popularity >= 90
          AND nb_plays >= 1000
        ORDER BY rnd
        LIMIT ?`
    )
    .all(DAILY_POOL)

  const dailyBody = JSON.stringify(daily.map(pack))
  await writeFile(join(OUT, 'daily.json'), dailyBody, 'utf8')

  // Theme counts drive the filter screen without loading every band.
  const themeCounts = db
    .prepare('SELECT theme, n FROM theme_counts ORDER BY n DESC')
    .all()
    .map((r) => ({ theme: r.theme, count: r.n }))

  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    source: 'https://database.lichess.org/ (CC0)',
    note: 'A sample of the full database, sized for offline use on a phone.',
    total,
    bandSize: BAND_SIZE,
    bands,
    daily: { file: 'daily.json', count: daily.length },
    themes: themeCounts
  }
  await writeFile(join(OUT, 'index.json'), JSON.stringify(index), 'utf8')

  const files = await readdir(OUT)
  let raw = 0
  let gz = 0
  for (const f of files) {
    const { size } = await stat(join(OUT, f))
    raw += size
    gz += gzipSync(await import('node:fs').then((fs) => fs.readFileSync(join(OUT, f)))).length
  }

  console.log(`\n  daily pool  ${daily.length} puzzles`)
  console.log(`  themes      ${themeCounts.length}`)
  console.log(`\nTotal: ${total.toLocaleString()} puzzles across ${bands.length} bands`)
  console.log(`  ${(raw / 1e6).toFixed(1)}MB raw, ${(gz / 1e6).toFixed(1)}MB gzipped over the wire`)
  console.log(`  ${OUT}`)

  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
