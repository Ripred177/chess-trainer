import { useEffect, useState } from 'react'
import type { Color } from '@shared/types'
import { pieceUrl } from '../themes/pieceSets'
import { colorKey, recolorSvg, type PieceColors } from './recolor'

/**
 * Supplies piece image URLs, recoloured when the player has asked for it.
 *
 * When recolouring is off this is just the file path, so the common case costs
 * nothing. When it is on, each SVG is fetched once, rewritten, and handed back
 * as a `data:` URI.
 *
 * A data URI rather than inlined `<svg>` is deliberate: a dozen sets define
 * gradients and filters with short ids like `#a`, and inlining thirty-two
 * copies into one document would collide on those ids and corrupt the board.
 * Keeping each piece inside its own image element keeps those ids scoped.
 */

const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P'] as const
const COLORS: Color[] = ['w', 'b']

/** Raw SVG text, keyed by URL. Piece art never changes at runtime. */
const rawCache = new Map<string, Promise<string>>()

/** Recoloured data URIs, keyed by set + colour configuration + piece. */
const uriCache = new Map<string, string>()

function loadRaw(url: string): Promise<string> {
  let pending = rawCache.get(url)
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Could not read ${url}: HTTP ${res.status}`)
      return res.text()
    })
    rawCache.set(url, pending)
  }
  return pending
}

function toDataUri(svg: string): string {
  // encodeURIComponent keeps this valid for any glyph the art might contain,
  // and avoids the cost of base64 for what is mostly ASCII.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export type PieceResolver = (color: Color, type: string) => string

/**
 * Build every recoloured sprite for one set. Resolves once all twelve are
 * ready, so the board never renders a half-recoloured position.
 */
async function buildSet(setId: string, colors: PieceColors): Promise<void> {
  const key = colorKey(colors)

  await Promise.all(
    COLORS.flatMap((color) =>
      PIECES.map(async (piece) => {
        const cacheKey = `${setId}|${key}|${color}${piece}`
        if (uriCache.has(cacheKey)) return

        const url = pieceUrl(setId, color, piece)
        const svg = await loadRaw(url)
        const side = color === 'w' ? colors.white : colors.black
        const recoloured = recolorSvg(svg, side, color === 'w', colors.tintAccents)
        uriCache.set(cacheKey, toDataUri(recoloured))
      })
    )
  )
}

/**
 * Resolver for the given set and colours.
 *
 * Falls back to the original artwork until the recoloured sprites are ready,
 * so switching sets never flashes an empty board.
 */
export function usePieceResolver(setId: string, colors: PieceColors): PieceResolver {
  const key = colorKey(colors)
  const [ready, setReady] = useState<string | null>(null)

  useEffect(() => {
    if (!colors.enabled) {
      setReady(null)
      return
    }

    let cancelled = false
    buildSet(setId, colors)
      .then(() => {
        if (!cancelled) setReady(`${setId}|${key}`)
      })
      .catch((err) => {
        // Recolouring is cosmetic; a failure should leave the original art in
        // place rather than break the board.
        console.error('Piece recolouring failed:', err)
        if (!cancelled) setReady(null)
      })

    return () => {
      cancelled = true
    }
  }, [setId, key, colors])

  if (!colors.enabled || ready !== `${setId}|${key}`) {
    return (color, type) => pieceUrl(setId, color, type)
  }

  return (color, type) => uriCache.get(`${setId}|${key}|${color}${type.toUpperCase()}`) ?? pieceUrl(setId, color, type)
}

/** Recoloured sprite for a single piece, for previews outside the board. */
export function usePieceSprite(setId: string, colors: PieceColors, color: Color, type: string): string {
  const resolve = usePieceResolver(setId, colors)
  return resolve(color, type)
}
