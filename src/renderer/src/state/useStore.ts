import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { BoardColors, Profile, Settings } from '@shared/types'
import { resolveBoardColors } from '../themes/boardThemes'

export type ViewId =
  | 'home'
  | 'play'
  | 'puzzles'
  | 'daily'
  | 'learn'
  | 'train'
  | 'games'
  | 'friends'
  | 'analysis'
  | 'settings'

interface StoreState {
  ready: boolean
  loadError: string | null
  profile: Profile | null
  view: ViewId
  /** Set when the puzzle database is missing so the UI can explain itself. */
  puzzlesAvailable: boolean
  puzzleError: string | null

  /**
   * PGN handed from the Games screen to the Analysis board. Consumed once on
   * arrival, so returning to Analysis later does not reload an old game.
   */
  analysisImport: string | null
  setAnalysisImport: (pgn: string | null) => void

  init: () => Promise<void>
  setView: (view: ViewId) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  refreshProfile: () => Promise<void>
  setProfile: (profile: Profile) => void
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  loadError: null,
  profile: null,
  view: 'home',
  puzzlesAvailable: false,
  puzzleError: null,
  analysisImport: null,

  init: async () => {
    try {
      const [profile, puzzles] = await Promise.all([
        window.chess.profile.get(),
        window.chess.puzzles.available()
      ])
      set({
        profile,
        puzzlesAvailable: puzzles.ok,
        puzzleError: puzzles.error,
        ready: true,
        loadError: null
      })
      applyAppTheme(profile.settings.theme)
    } catch (err) {
      set({ ready: true, loadError: err instanceof Error ? err.message : String(err) })
    }
  },

  setView: (view) => set({ view }),

  setAnalysisImport: (pgn) => set({ analysisImport: pgn }),

  updateSettings: async (patch) => {
    const profile = get().profile
    if (!profile) return
    // Update optimistically so colour pickers and sliders feel immediate; the
    // main process is the source of truth but a round trip per keystroke would
    // make dragging a slider feel laggy.
    set({ profile: { ...profile, settings: { ...profile.settings, ...patch } } })
    const saved = await window.chess.profile.updateSettings(patch)
    const current = get().profile
    if (current) set({ profile: { ...current, settings: saved } })
    if (patch.theme) applyAppTheme(saved.theme)
  },

  refreshProfile: async () => {
    const profile = await window.chess.profile.get()
    set({ profile })
  },

  setProfile: (profile) => set({ profile })
}))

/** Reflect the chosen chrome theme onto <html> for the CSS token ramp. */
export function applyAppTheme(theme: Settings['theme']): void {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const light = theme === 'light' || (theme === 'system' && prefersLight)
  document.documentElement.classList.toggle('theme-light', light)
}

// Keep the app in step with the OS when the player has chosen "system".
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  const settings = useStore.getState().profile?.settings
  if (settings?.theme === 'system') applyAppTheme('system')
})

// ------------------------------------------------------------- selectors ---

/** Settings with sensible fallbacks while the profile is still loading. */
export function useSettings(): Settings {
  const profile = useStore((s) => s.profile)
  return profile?.settings ?? FALLBACK_SETTINGS
}

/** Piece recolouring configuration, with a safe fallback while loading. */
export function usePieceColors(): Settings['pieceColors'] {
  return useSettings().pieceColors
}

export function useBoardColors(): BoardColors {
  const settings = useSettings()
  return resolveBoardColors(settings.boardThemeId, settings.boardColorOverrides)
}

const FALLBACK_SETTINGS: Settings = {
  theme: 'dark',
  boardThemeId: 'slate',
  boardColorOverrides: {},
  pieceSetId: 'cburnett',
  pieceColors: {
    enabled: false,
    white: { piece: '#f7f3ea', outline: '#1c1c1c' },
    black: { piece: '#2a2a2e', outline: '#e8e8ea' },
    tintAccents: false
  },
  boardSize: 560,
  showCoordinates: true,
  showLegalMoves: true,
  highlightLastMove: true,
  animationMs: 180,
  soundEnabled: true,
  soundVolume: 0.6,
  autoPromoteToQueen: false,
  moveInput: 'both',
  showEvalBar: true,
  engineThreads: 2,
  engineHashMb: 128,
  confirmResign: true,
  timeControlId: 'untimed',
  lowTimeWarningSec: 10
}

// ------------------------------------------------------- responsive sizing ---

/**
 * True when the app is running as a web page rather than inside Electron.
 * `__IS_WEB__` is substituted at build time, so the desktop bundle drops the
 * web-only branches entirely.
 */
export const IS_WEB: boolean = typeof __IS_WEB__ !== 'undefined' && __IS_WEB__

/** Below this the sidebar becomes a bottom bar and panels stack under the board. */
export const NARROW_PX = 900

const viewportListeners = new Set<() => void>()
let viewportSnapshot = `${window.innerWidth}x${window.innerHeight}`

window.addEventListener('resize', () => {
  const next = `${window.innerWidth}x${window.innerHeight}`
  if (next === viewportSnapshot) return
  viewportSnapshot = next
  for (const listener of viewportListeners) listener()
})

function subscribeViewport(listener: () => void): () => void {
  viewportListeners.add(listener)
  return () => viewportListeners.delete(listener)
}

/** A string rather than an object so React's identity check stays stable. */
function viewportKey(): string {
  return viewportSnapshot
}

export function useViewport(): { width: number; height: number; narrow: boolean } {
  const key = useSyncExternalStore(subscribeViewport, viewportKey, () => '1280x800')
  const [width, height] = key.split('x').map(Number)
  return { width, height, narrow: width < NARROW_PX }
}

/**
 * The board size actually used for rendering.
 *
 * The setting is a preference, not a command: a 560px board does not fit a
 * phone, and it does not fit a small desktop window either. This clamps the
 * preference to what the viewport can show, leaving room for the navigation,
 * the page header, and the side panel when there is one beside the board.
 */
/**
 * The home indicator's inset, read from the CSS environment. It is 0 on any
 * device without one, and on iOS it is only non-zero once the page has asked
 * for viewport-fit=cover.
 */
function safeAreaBottom(): number {
  if (typeof getComputedStyle !== 'function') return 0
  const probe = document.documentElement
  const value = getComputedStyle(probe).getPropertyValue('--safe-bottom')
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function useBoardSize(): number {
  const preferred = useSettings().boardSize
  const { width, height, narrow } = useViewport()

  // Wide: sidebar (224) + side panel (384) + gaps and padding (~112).
  // Narrow: the board is the page, less its padding.
  const horizontalChrome = narrow ? 24 : 720
  // Vertical on a phone: the tab bar (~56) plus the home indicator, the page
  // header (~64), and enough of the panel below the board to show that there
  // is more to scroll to. On a desktop just the page header.
  const verticalChrome = narrow ? 244 + safeAreaBottom() : 152

  return Math.max(
    240,
    Math.floor(Math.min(preferred, width - horizontalChrome, height - verticalChrome))
  )
}
