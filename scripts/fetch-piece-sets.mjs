/**
 * Downloads the Lichess piece sets into resources/pieces/.
 *
 * Lichess ships each set as twelve SVGs named <colour><PIECE>.svg, which is the
 * de-facto standard layout, so the renderer can address any piece in any set
 * with one predictable path.
 *
 * Licensing varies per set (GPL, CC BY-SA, CC0, and a few bespoke permissions).
 * We copy the upstream COPYING.md verbatim alongside the art and surface it in
 * the app's Credits screen rather than restating terms ourselves.
 *
 * Usage: node scripts/fetch-piece-sets.mjs [--sets a,b,c]
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'resources/pieces')

const REPO = 'lichess-org/lila'
const BRANCH = 'master'
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/public/piece`
const API = `https://api.github.com/repos/${REPO}/contents/public/piece?ref=${BRANCH}`

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P']
const COLORS = ['w', 'b']

/** Retry transient network failures; GitHub raw occasionally rate-limits. */
async function fetchText(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

async function listSets() {
  const res = await fetch(API, { headers: { accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`Could not list piece sets: HTTP ${res.status}`)
  const json = await res.json()
  return json.filter((e) => e.type === 'dir').map((e) => e.name).sort()
}

async function main() {
  const args = process.argv.slice(2)
  const setsArg = args.indexOf('--sets')

  const sets = setsArg >= 0 ? args[setsArg + 1].split(',') : await listSets()
  console.log(`Fetching ${sets.length} piece sets into resources/pieces/\n`)

  await mkdir(OUT, { recursive: true })

  const manifest = []
  const failures = []

  // A little concurrency keeps this to a few seconds without hammering raw.
  const queue = [...sets]
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const set = queue.shift()
      if (!set) break
      const dir = join(OUT, set)
      await mkdir(dir, { recursive: true })

      let got = 0
      for (const color of COLORS) {
        for (const piece of PIECES) {
          const name = `${color}${piece}.svg`
          try {
            let svg = await fetchText(`${RAW}/${set}/${name}`)
            if (svg == null) {
              failures.push(`${set}/${name} (404)`)
              continue
            }

            // A few sets (disguised) store the twelve pieces as git symlinks to
            // one shared file. Raw serves the link target as plain text, so a
            // tiny non-SVG body means "follow this and inline the real art".
            if (!svg.trimStart().startsWith('<')) {
              const target = svg.trim()
              if (target.length > 64 || target.includes('\n')) {
                failures.push(`${set}/${name} (not SVG)`)
                continue
              }
              const resolved = await fetchText(`${RAW}/${set}/${target}`)
              if (resolved == null || !resolved.trimStart().startsWith('<')) {
                failures.push(`${set}/${name} (unresolved link -> ${target})`)
                continue
              }
              svg = resolved
            }

            await writeFile(join(dir, name), svg, 'utf8')
            got++
          } catch (err) {
            failures.push(`${set}/${name} (${err.message})`)
          }
        }
      }

      if (got === 12) {
        manifest.push(set)
        console.log(`  ok   ${set}`)
      } else {
        console.log(`  WARN ${set} — only ${got}/12 pieces`)
        if (got > 0) manifest.push(set)
      }
    }
  })

  await Promise.all(workers)

  const copying = await fetchText(`${RAW}/COPYING.md`)
  if (copying) {
    await writeFile(join(OUT, 'COPYING.md'), copying, 'utf8')
    console.log('\n  ok   COPYING.md (upstream licence notices)')
  } else {
    console.log('\n  WARN could not fetch COPYING.md — check licences manually')
  }

  manifest.sort()
  await writeFile(
    join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        source: `https://github.com/${REPO}/tree/${BRANCH}/public/piece`,
        licences: 'See COPYING.md — terms vary per set.',
        fetchedAt: new Date().toISOString(),
        sets: manifest
      },
      null,
      2
    ),
    'utf8'
  )

  const dirs = (await readdir(OUT, { withFileTypes: true })).filter((d) => d.isDirectory())
  console.log(`\nDone: ${manifest.length} usable sets in ${dirs.length} directories.`)
  if (failures.length) {
    console.log(`${failures.length} files failed:`)
    for (const f of failures.slice(0, 20)) console.log(`  - ${f}`)
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
