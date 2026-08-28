/**
 * Streaming reader for the Lichess database dumps.
 *
 * Those files are not a single zstd stream. They are a chain of independently
 * compressed ~32MiB frames, each preceded by a 12-byte zstd *skippable* frame
 * whose 4-byte payload holds the compressed length of the frame that follows:
 *
 *   [skippable: len=4, payload=<uint32 compressed size>] [zstd frame] ...
 *
 * That layout lets a client seek into the middle of a 1GB dump. libzstd walks
 * past skippable frames transparently, but Node's `ZstdDecompress` stops at the
 * first frame boundary and then rejects the skippable header with "Unknown
 * frame descriptor", so we walk the chain ourselves.
 *
 * A plain single-frame .zst still works: if the file does not begin with a
 * skippable frame we hand it to Node's stream decoder unchanged.
 */

import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createZstdDecompress, zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const decompress = promisify(zstdDecompress)

/** Skippable frame magics occupy the range 0x184D2A50-0x184D2A5F. */
const SKIPPABLE_LO = 0x184d2a50
const SKIPPABLE_HI = 0x184d2a5f
const ZSTD_MAGIC = 0xfd2fb528

const SKIPPABLE_HEADER_BYTES = 8

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read)
    if (bytesRead === 0) break
    read += bytesRead
  }
  return read === length ? buffer : buffer.subarray(0, read)
}

/**
 * Decompressed bytes of `path`, as a Readable.
 *
 * Frames are decoded one at a time and pushed downstream, so peak memory stays
 * at roughly one frame (~32MiB) regardless of how large the dump is.
 */
export function createDumpStream(path) {
  return Readable.from(iterateFrames(path))
}

async function* iterateFrames(path) {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()

    const head = await readExact(handle, 4, 0)
    if (head.length < 4) return

    const firstMagic = head.readUInt32LE(0)

    // A conventional .zst file: let Node handle it.
    if (firstMagic === ZSTD_MAGIC) {
      await handle.close()
      yield* createReadStream(path).pipe(createZstdDecompress())
      return
    }

    if (firstMagic < SKIPPABLE_LO || firstMagic > SKIPPABLE_HI) {
      throw new Error(
        `${path} is not a zstd file (magic 0x${firstMagic.toString(16).padStart(8, '0')})`
      )
    }

    let offset = 0
    while (offset < size) {
      const header = await readExact(handle, SKIPPABLE_HEADER_BYTES, offset)
      if (header.length < SKIPPABLE_HEADER_BYTES) break

      const magic = header.readUInt32LE(0)
      if (magic < SKIPPABLE_LO || magic > SKIPPABLE_HI) {
        throw new Error(`Expected a skippable frame at byte ${offset}, found 0x${magic.toString(16)}`)
      }

      const payloadLength = header.readUInt32LE(4)
      const payload = await readExact(handle, payloadLength, offset + SKIPPABLE_HEADER_BYTES)
      offset += SKIPPABLE_HEADER_BYTES + payloadLength

      // The payload tells us how long the compressed frame that follows is.
      if (payloadLength !== 4) {
        throw new Error(`Unexpected skippable payload of ${payloadLength} bytes at ${offset}`)
      }
      const frameLength = payload.readUInt32LE(0)
      if (frameLength <= 0 || offset + frameLength > size) {
        throw new Error(`Frame length ${frameLength} at byte ${offset} runs past end of file`)
      }

      const compressed = await readExact(handle, frameLength, offset)
      offset += frameLength

      const frameMagic = compressed.readUInt32LE(0)
      if (frameMagic !== ZSTD_MAGIC) {
        throw new Error(`Expected a zstd frame at byte ${offset - frameLength}`)
      }

      yield await decompress(compressed)
    }
  } finally {
    // The plain-.zst path closes the handle before delegating.
    await handle.close().catch(() => {})
  }
}
