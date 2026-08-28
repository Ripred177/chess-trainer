import licenses from '../data/pieceLicenses.json'

export interface PieceSet {
  id: string
  name: string
  author: string
  license: string
  /** True for CC BY-NC-SA art, which may not be used commercially. */
  nonCommercial: boolean
}

/** Turn a directory name like `kiwen-suwi` into `Kiwen Suwi`. */
function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Names that title-casing gets wrong. */
const DISPLAY_NAMES: Record<string, string> = {
  cburnett: 'CBurnett',
  icpieces: 'IC Pieces',
  rhosgfx: 'RhosGFX',
  xkcd: 'xkcd',
  chess7: 'Chess7',
  mpchess: 'MPChess',
  'kiwen-suwi': 'Kiwen Suwi'
}

const raw = licenses as Record<string, { author: string; license: string }>

export const PIECE_SETS: PieceSet[] = Object.entries(raw)
  .map(([id, meta]) => ({
    id,
    name: DISPLAY_NAMES[id] ?? titleCase(id),
    author: meta.author,
    license: meta.license,
    nonCommercial: /NC/.test(meta.license)
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

export const DEFAULT_PIECE_SET = 'cburnett'

export function getPieceSet(id: string): PieceSet {
  return PIECE_SETS.find((s) => s.id === id) ?? PIECE_SETS.find((s) => s.id === DEFAULT_PIECE_SET)!
}

/**
 * Path to one piece's SVG.
 *
 * Vite is configured with a relative base so this resolves correctly both from
 * the dev server and from the `file://` document in a packaged build.
 */
export function pieceUrl(setId: string, color: 'w' | 'b', piece: string): string {
  const letter = piece.toUpperCase()
  return `${import.meta.env.BASE_URL}pieces/${setId}/${color}${letter}.svg`
}

/** The six pieces, in the order used for set previews. */
export const PREVIEW_ORDER = ['K', 'Q', 'R', 'B', 'N', 'P'] as const
