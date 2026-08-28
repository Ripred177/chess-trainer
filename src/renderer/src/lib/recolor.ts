/**
 * Recolouring for piece art.
 *
 * A naive find-and-replace of white and black only works on the flat sets. Of
 * the 41 bundled sets, 15 use three or more tones to model shading, and
 * flattening those would destroy the artwork.
 *
 * So each colour in the SVG is instead mapped by *luminance* onto a ramp
 * between two chosen endpoints. A flat two-tone set lands exactly on the two
 * endpoints; a shaded set keeps its midtones, just in the new palette.
 *
 * Saturated colours are treated as accents — the pink of a bunny's ear, the
 * red of a Firi crest — and left alone by default, because remapping them by
 * luminance would turn every set monochrome.
 */

export interface SideColors {
  /** The body of the piece. */
  piece: string
  /** Outlines and, on dark sets, interior highlights. */
  outline: string
}

export interface PieceColors {
  enabled: boolean
  white: SideColors
  black: SideColors
  /** Recolour saturated accents too, instead of preserving them. */
  tintAccents: boolean
}

export const DEFAULT_PIECE_COLORS: PieceColors = {
  enabled: false,
  white: { piece: '#f7f3ea', outline: '#1c1c1c' },
  black: { piece: '#2a2a2e', outline: '#e8e8ea' },
  tintAccents: false
}

interface Rgb {
  r: number
  g: number
  b: number
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  grey: '#808080',
  gray: '#808080',
  silver: '#c0c0c0'
}

export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase()
  if (!value || value === 'none' || value === 'currentcolor' || value === 'transparent') return null

  const named = NAMED[value]
  const hex = named ?? value

  if (hex.startsWith('#')) {
    const digits = hex.slice(1)
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = [0, 1, 2].map((i) => parseInt(digits[i] + digits[i], 16))
      return { r, g, b }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16)
      }
    }
    return null
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  }

  return null
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`
}

/** Perceptual luminance, 0 (black) to 1 (white). */
function luminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** HSL saturation, used only to decide whether a colour is an accent. */
function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  if (max === min) return 0
  const l = (max + min) / 2
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t))
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  }
}

/** Colours at least this saturated are treated as deliberate accents. */
const ACCENT_SATURATION = 0.28

/**
 * Map one colour onto the ramp for a side.
 *
 * White pieces run outline (dark) to piece (light); black pieces run piece
 * (dark) to outline (light), so in both cases "piece" names the body colour and
 * "outline" names the edges. That is the mental model the settings screen
 * presents.
 */
export function mapColor(input: string, side: SideColors, isWhite: boolean, tintAccents: boolean): string | null {
  const rgb = parseColor(input)
  if (!rgb) return null

  if (!tintAccents && saturation(rgb) >= ACCENT_SATURATION) return null

  const piece = parseColor(side.piece)
  const outline = parseColor(side.outline)
  if (!piece || !outline) return null

  const low = isWhite ? outline : piece
  const high = isWhite ? piece : outline

  return toHex(mix(low, high, luminance(rgb)))
}

/**
 * Colours only ever appear as the value of a paint property, so the rewrite is
 * anchored to those properties.
 *
 * A blanket search for hex literals would also match fragment references such
 * as `url(#abc)`, which several sets use for filters and gradients — rewriting
 * one of those would silently break the artwork.
 */
const PAINT = /((?:fill|stroke|stop-color|flood-color|lighting-color)\s*(?:=\s*["']|:\s*))([^"';)\s]+)/gi

export function recolorSvg(svg: string, side: SideColors, isWhite: boolean, tintAccents: boolean): string {
  return svg.replace(PAINT, (match, prefix: string, value: string) => {
    const mapped = mapColor(value, side, isWhite, tintAccents)
    return mapped ? `${prefix}${mapped}` : match
  })
}

/** Stable cache key for a colour configuration. */
export function colorKey(colors: PieceColors): string {
  if (!colors.enabled) return 'off'
  return [
    colors.white.piece,
    colors.white.outline,
    colors.black.piece,
    colors.black.outline,
    colors.tintAccents ? 'accents' : 'noaccents'
  ].join('|')
}

export interface ColorPreset {
  id: string
  name: string
  white: SideColors
  black: SideColors
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'classic',
    name: 'Ivory & Ebony',
    white: { piece: '#f7f3ea', outline: '#1c1c1c' },
    black: { piece: '#2a2a2e', outline: '#e8e8ea' }
  },
  {
    id: 'cherry',
    name: 'Cherry & Navy',
    white: { piece: '#f6d9d4', outline: '#7d1f27' },
    black: { piece: '#1e2a4a', outline: '#c9d4ef' }
  },
  {
    id: 'mint',
    name: 'Mint & Charcoal',
    white: { piece: '#dff2e4', outline: '#20463a' },
    black: { piece: '#25302c', outline: '#bfe6cf' }
  },
  {
    id: 'gold',
    name: 'Gold & Slate',
    white: { piece: '#f2d99a', outline: '#5a4520' },
    black: { piece: '#33383f', outline: '#d9c187' }
  },
  {
    id: 'rose',
    name: 'Rose & Plum',
    white: { piece: '#f8dde8', outline: '#7a2c50' },
    black: { piece: '#3a2038', outline: '#efc3dc' }
  },
  {
    id: 'neon',
    name: 'Neon',
    white: { piece: '#d8fff4', outline: '#00806a' },
    black: { piece: '#141826', outline: '#5df2c4' }
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    white: { piece: '#e8f1fb', outline: '#123a63' },
    black: { piece: '#123a63', outline: '#9dc6ee' }
  },
  {
    id: 'mono',
    name: 'High contrast',
    white: { piece: '#ffffff', outline: '#000000' },
    black: { piece: '#000000', outline: '#ffffff' }
  }
]
