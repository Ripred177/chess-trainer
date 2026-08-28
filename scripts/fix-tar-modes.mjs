/**
 * Restores the executable bit inside a tarball packed on Windows.
 *
 * NTFS has no executable bit, so a Linux tarball built here arrives with every
 * entry as 0644 — including the launcher. Extracted on Linux it simply will not
 * run, and the failure ("permission denied") gives no hint why.
 *
 * Git Bash cannot help: `chmod +x` on this filesystem does not stick, so
 * re-packing changes nothing. Instead this rewrites the mode field of the
 * relevant tar headers in place and recomputes their checksums, which is exact
 * and needs no Linux tooling.
 *
 * Usage: node scripts/fix-tar-modes.mjs <archive.tar.gz>
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat, unlink, rename } from 'node:fs/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { basename } from 'node:path'

const BLOCK = 512

/** Files that must be executable for the app to start. */
const EXECUTABLE = [
  /(^|\/)chess-trainer$/,
  /(^|\/)chrome-sandbox$/,
  /(^|\/)chrome_crashpad_handler$/,
  /resources\/engine\/stockfish$/
]

/** Tar stores numbers as NUL/space terminated octal strings. */
function readOctal(buf, offset, length) {
  const text = buf.toString('ascii', offset, offset + length).replace(/\0.*$/, '').trim()
  return text ? parseInt(text, 8) : 0
}

function writeOctal(buf, offset, length, value) {
  // `length - 1` digits, NUL terminated — the conventional GNU tar layout.
  const text = value.toString(8).padStart(length - 1, '0') + '\0'
  buf.write(text, offset, length, 'ascii')
}

/**
 * The header checksum is computed with its own field read as eight spaces,
 * then written back as six octal digits, a NUL, and a space.
 */
function applyChecksum(header) {
  header.write('        ', 148, 8, 'ascii')
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += header[i]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
}

function entryPath(header) {
  const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
  const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
  return prefix ? `${prefix}/${name}` : name
}

async function main() {
  const archive = process.argv[2]
  if (!archive) {
    console.error('Usage: node scripts/fix-tar-modes.mjs <archive.tar.gz>')
    process.exit(1)
  }

  const tarPath = `${archive}.tmp.tar`
  const outPath = `${archive}.tmp.gz`

  console.log(`Decompressing ${basename(archive)}…`)
  await pipeline(createReadStream(archive), createGunzip(), createWriteStream(tarPath))

  const { size } = await stat(tarPath)
  console.log(`  ${(size / 1e9).toFixed(2)} GB of tar to walk`)

  const handle = await open(tarPath, 'r+')
  const header = Buffer.alloc(BLOCK)
  let offset = 0
  let patched = 0
  let entries = 0

  while (offset + BLOCK <= size) {
    const { bytesRead } = await handle.read(header, 0, BLOCK, offset)
    if (bytesRead < BLOCK) break

    // Two consecutive zero blocks mark the end of the archive.
    if (header.every((b) => b === 0)) break

    entries++
    const path = entryPath(header)
    const entrySize = readOctal(header, 124, 12)

    if (EXECUTABLE.some((re) => re.test(path))) {
      const mode = readOctal(header, 100, 8)
      // Preserve any type bits, add owner/group/other execute.
      const next = mode | 0o111
      if (next !== mode) {
        writeOctal(header, 100, 8, next)
        applyChecksum(header)
        await handle.write(header, 0, BLOCK, offset)
        console.log(`  +x  ${path}  (${mode.toString(8)} -> ${next.toString(8)})`)
        patched++
      }
    }

    offset += BLOCK + Math.ceil(entrySize / BLOCK) * BLOCK
  }

  await handle.close()
  console.log(`Walked ${entries} entries, patched ${patched}.`)

  if (patched === 0) {
    await unlink(tarPath)
    console.log('Nothing to change; archive left as it was.')
    return
  }

  console.log('Recompressing…')
  await pipeline(createReadStream(tarPath), createGzip({ level: 6 }), createWriteStream(outPath))
  await unlink(tarPath)
  await unlink(archive)
  await rename(outPath, archive)

  const final = await stat(archive)
  console.log(`Done: ${basename(archive)} (${(final.size / 1e9).toFixed(2)} GB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
