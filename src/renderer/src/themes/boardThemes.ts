import type { BoardColors } from '@shared/types'

export interface BoardTheme {
  id: string
  name: string
  /** Grouping shown in the theme picker. */
  family: 'classic' | 'modern' | 'natural' | 'bold'
  colors: BoardColors
}

/**
 * Highlight colours are deliberately semi-transparent so they tint the square
 * beneath rather than replacing it. That keeps a highlighted light square and a
 * highlighted dark square visibly different, which matters when you're reading
 * a position quickly.
 */
function highlights(overrides: Partial<BoardColors> = {}): Omit<BoardColors, 'light' | 'dark'> {
  return {
    lastMove: 'rgba(255, 214, 92, 0.42)',
    selected: 'rgba(120, 220, 140, 0.48)',
    legal: 'rgba(20, 30, 25, 0.28)',
    check: 'rgba(230, 70, 60, 0.62)',
    coordLight: 'rgba(0, 0, 0, 0.48)',
    coordDark: 'rgba(255, 255, 255, 0.62)',
    ...overrides
  }
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'slate',
    name: 'Slate',
    family: 'modern',
    colors: { light: '#dfe3ea', dark: '#7d8a9e', ...highlights() }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    family: 'modern',
    colors: {
      light: '#c9ced6',
      dark: '#5c6470',
      ...highlights({ legal: 'rgba(255, 255, 255, 0.26)' })
    }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    family: 'modern',
    colors: {
      light: '#8892b0',
      dark: '#3b4666',
      ...highlights({ legal: 'rgba(255, 255, 255, 0.3)', coordLight: 'rgba(0,0,0,0.55)' })
    }
  },
  {
    id: 'brown',
    name: 'Classic Brown',
    family: 'classic',
    colors: { light: '#f0d9b5', dark: '#b58863', ...highlights() }
  },
  {
    id: 'walnut',
    name: 'Walnut',
    family: 'natural',
    colors: { light: '#e8d3b0', dark: '#8b5a3c', ...highlights() }
  },
  {
    id: 'maple',
    name: 'Maple',
    family: 'natural',
    colors: { light: '#f5e4c8', dark: '#c08c5a', ...highlights() }
  },
  {
    id: 'green',
    name: 'Tournament Green',
    family: 'classic',
    colors: { light: '#eeeed2', dark: '#769656', ...highlights() }
  },
  {
    id: 'forest',
    name: 'Forest',
    family: 'natural',
    colors: {
      light: '#d7e2c8',
      dark: '#4e6b3f',
      ...highlights({ legal: 'rgba(255,255,255,0.28)' })
    }
  },
  {
    id: 'ocean',
    name: 'Ocean',
    family: 'modern',
    colors: { light: '#dbe9f4', dark: '#5c8db8', ...highlights() }
  },
  {
    id: 'teal',
    name: 'Teal',
    family: 'modern',
    colors: { light: '#d6ece8', dark: '#4f8f88', ...highlights() }
  },
  {
    id: 'ice',
    name: 'Ice',
    family: 'modern',
    colors: { light: '#eef4f8', dark: '#a8c0d0', ...highlights() }
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    family: 'natural',
    colors: { light: '#f2e8d5', dark: '#c4a878', ...highlights() }
  },
  {
    id: 'rose',
    name: 'Rose',
    family: 'bold',
    colors: { light: '#f6e0e0', dark: '#b56b78', ...highlights() }
  },
  {
    id: 'purple',
    name: 'Amethyst',
    family: 'bold',
    colors: { light: '#e6dff0', dark: '#8168a8', ...highlights() }
  },
  {
    id: 'crimson',
    name: 'Crimson',
    family: 'bold',
    colors: {
      light: '#f0dcdc',
      dark: '#9c4a4a',
      ...highlights({ check: 'rgba(255, 200, 60, 0.7)' })
    }
  },
  {
    id: 'mono',
    name: 'Monochrome',
    family: 'modern',
    colors: {
      light: '#ffffff',
      dark: '#9a9a9a',
      ...highlights({ legal: 'rgba(0,0,0,0.32)' })
    }
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    family: 'classic',
    colors: {
      light: '#faf7f0',
      dark: '#c8c2b4',
      ...highlights({ legal: 'rgba(0,0,0,0.3)', coordDark: 'rgba(0,0,0,0.5)' })
    }
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    family: 'bold',
    colors: {
      light: '#ffffff',
      dark: '#3a3a3a',
      lastMove: 'rgba(255, 210, 0, 0.6)',
      selected: 'rgba(0, 200, 90, 0.6)',
      legal: 'rgba(0, 140, 255, 0.55)',
      check: 'rgba(255, 40, 40, 0.75)',
      coordLight: 'rgba(0,0,0,0.75)',
      coordDark: 'rgba(255,255,255,0.85)'
    }
  }
]

export const DEFAULT_BOARD_THEME = BOARD_THEMES[0]

export function getBoardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? DEFAULT_BOARD_THEME
}

/** Apply the player's per-colour tweaks on top of a preset. */
export function resolveBoardColors(themeId: string, overrides: Partial<BoardColors> = {}): BoardColors {
  return { ...getBoardTheme(themeId).colors, ...overrides }
}

/** The colours a player is allowed to customise, in the order shown in Settings. */
export const EDITABLE_COLORS: { key: keyof BoardColors; label: string; hint: string }[] = [
  { key: 'light', label: 'Light squares', hint: 'The pale half of the board' },
  { key: 'dark', label: 'Dark squares', hint: 'The deep half of the board' },
  { key: 'lastMove', label: 'Last move', hint: 'Tint marking the move just played' },
  { key: 'selected', label: 'Selection', hint: 'The piece you have picked up' },
  { key: 'legal', label: 'Legal moves', hint: 'Dots showing where you may go' },
  { key: 'check', label: 'Check', hint: 'The square of a king in check' },
  { key: 'coordLight', label: 'Coordinates (light)', hint: 'Rank and file labels on light squares' },
  { key: 'coordDark', label: 'Coordinates (dark)', hint: 'Rank and file labels on dark squares' }
]
