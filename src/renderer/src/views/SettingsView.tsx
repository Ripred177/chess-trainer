import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Upload, RotateCcw, Info, AlertTriangle } from 'lucide-react'
import type { BoardColors } from '@shared/types'
import Board from '../components/Board'
import { PageHeader, Section, Toggle, Slider, ColorField } from '../components/ui'
import {
  IS_WEB,
  useBoardColors,
  usePieceColors,
  useSettings,
  useStore,
  useViewport
} from '../state/useStore'
import { BOARD_THEMES, EDITABLE_COLORS, getBoardTheme, resolveBoardColors } from '../themes/boardThemes'
import { PIECE_SETS, PREVIEW_ORDER } from '../themes/pieceSets'
import { usePieceResolver } from '../lib/pieceSprites'
import { COLOR_PRESETS } from '../lib/recolor'
import { play } from '../lib/sound'

/** A position with a bit of everything, so previews are actually informative. */
const PREVIEW_FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1'

type Tab = 'board' | 'pieces' | 'play' | 'engine' | 'profile'

const TABS: { id: Tab; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'pieces', label: 'Pieces' },
  { id: 'play', label: 'Gameplay' },
  { id: 'engine', label: 'Engine' },
  { id: 'profile', label: 'Profile' }
]

export default function SettingsView(): React.JSX.Element {
  const settings = useSettings()
  const colors = useBoardColors()
  const { narrow } = useViewport()
  const [tab, setTab] = useState<Tab>('board')

  // On a phone the preview rides along at the top of the scroll as a small
  // board; on a wide screen it sits beside the controls at full size. It used
  // to be a fixed 340px in a non-wrapping row, which squeezed the controls
  // column to nothing and left the preview covering the whole screen.
  const previewSize = narrow ? 128 : 340

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <PageHeader title="Settings" subtitle="Make the board yours." />

      {/* Five tabs do not fit across a phone, so let them scroll. */}
      <div className="flex gap-1 mb-4 sm:mb-6 -mx-3 px-3 sm:mx-0 sm:px-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-lg text-sm transition-colors shrink-0"
            style={{
              background: tab === t.id ? 'var(--surface-3)' : 'transparent',
              fontWeight: tab === t.id ? 600 : 500,
              color: tab === t.id ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start">
        {/*
          Live preview stays visible so every change is immediately verifiable.
          It leads on a phone (sticky strip across the top) and sits to the
          right of the controls on a wide screen, hence the order swap.
        */}
        <div
          className={
            narrow
              ? 'order-1 w-full sticky top-0 z-10 flex items-center gap-3 py-2 -mx-3 px-3'
              : 'order-2 shrink-0 sticky top-8'
          }
          style={
            narrow
              ? { background: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)' }
              : undefined
          }
        >
          {!narrow && <div className="label mb-2">Preview</div>}
          <Board
            fen={PREVIEW_FEN}
            movableFor="both"
            colors={colors}
            pieceSet={settings.pieceSetId}
            size={previewSize}
            showCoordinates={narrow ? false : settings.showCoordinates}
            showLegalMoves={settings.showLegalMoves}
            highlightLastMove={settings.highlightLastMove}
            lastMove={{ from: 'f1', to: 'c4' }}
            animationMs={settings.animationMs}
            onMove={() => play('move')}
          />
          <p
            className={narrow ? 'text-xs flex-1' : 'text-xs mt-2 max-w-[340px]'}
            style={{ color: 'var(--text-muted)' }}
          >
            {narrow
              ? 'A live preview. Drag a piece to test the feel.'
              : 'The preview is a real board — drag a piece to test the feel of your settings.'}
          </p>
        </div>

        <div className="order-2 lg:order-1 flex-1 min-w-0 w-full">
          {tab === 'board' && <BoardTab />}
          {tab === 'pieces' && <PiecesTab />}
          {tab === 'play' && <PlayTab />}
          {tab === 'engine' && <EngineTab />}
          {tab === 'profile' && <ProfileTab />}
        </div>
      </div>
    </div>
  )
}

function BoardTab(): React.JSX.Element {
  const settings = useSettings()
  const updateSettings = useStore((s) => s.updateSettings)
  const overrides = settings.boardColorOverrides
  const resolved = resolveBoardColors(settings.boardThemeId, overrides)

  const families = useMemo(() => {
    const groups = new Map<string, typeof BOARD_THEMES>()
    for (const theme of BOARD_THEMES) {
      const list = groups.get(theme.family) ?? []
      list.push(theme)
      groups.set(theme.family, list)
    }
    return [...groups.entries()]
  }, [])

  const setColor = (key: keyof BoardColors, value: string): void => {
    void updateSettings({ boardColorOverrides: { ...overrides, [key]: value } })
  }

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <>
      <Section title="Board theme" description="Pick a preset, then adjust any colour below.">
        {families.map(([family, themes]) => (
          <div key={family} className="mb-4 last:mb-0">
            <div className="label mb-2 capitalize">{family}</div>
            <div className="grid grid-cols-4 gap-2">
              {themes.map((theme) => {
                const active = settings.boardThemeId === theme.id
                return (
                  <button
                    key={theme.id}
                    onClick={() => void updateSettings({ boardThemeId: theme.id })}
                    className="rounded-lg overflow-hidden text-left transition-all"
                    style={{
                      border: `2px solid ${active ? 'var(--color-accent-500)' : 'var(--border-subtle)'}`
                    }}
                    title={theme.name}
                  >
                    {/* A 2x2 checker is enough to judge a board at a glance. */}
                    <div className="grid grid-cols-2" style={{ height: 44 }}>
                      <div style={{ background: theme.colors.light }} />
                      <div style={{ background: theme.colors.dark }} />
                      <div style={{ background: theme.colors.dark }} />
                      <div style={{ background: theme.colors.light }} />
                    </div>
                    <div className="px-2 py-1.5 text-xs truncate" style={{ background: 'var(--surface-2)' }}>
                      {theme.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Custom colours"
        description="Overrides sit on top of the selected theme."
        actions={
          hasOverrides && (
            <button className="btn btn-ghost text-xs" onClick={() => void updateSettings({ boardColorOverrides: {} })}>
              <RotateCcw size={13} /> Reset to {getBoardTheme(settings.boardThemeId).name}
            </button>
          )
        }
      >
        {EDITABLE_COLORS.map(({ key, label, hint }) => (
          <ColorField
            key={key}
            label={label}
            hint={hint}
            value={resolved[key]}
            onChange={(value) => setColor(key, value)}
          />
        ))}
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          Highlight colours accept <code>rgba(…)</code> so they can tint the square underneath rather than
          covering it.
        </p>
      </Section>

      <Section title="Board display">
        <Slider
          label="Board size"
          value={settings.boardSize}
          min={360}
          max={760}
          step={20}
          onChange={(v) => void updateSettings({ boardSize: v })}
          format={(v) => `${v}px`}
        />
        <Toggle
          label="Show coordinates"
          hint="Rank and file labels along the edges"
          checked={settings.showCoordinates}
          onChange={(v) => void updateSettings({ showCoordinates: v })}
        />
        <Toggle
          label="Show legal moves"
          hint="Dots and rings marking where a selected piece can go"
          checked={settings.showLegalMoves}
          onChange={(v) => void updateSettings({ showLegalMoves: v })}
        />
        <Toggle
          label="Highlight the last move"
          checked={settings.highlightLastMove}
          onChange={(v) => void updateSettings({ highlightLastMove: v })}
        />
        <Slider
          label="Move animation"
          value={settings.animationMs}
          min={0}
          max={500}
          step={20}
          onChange={(v) => void updateSettings({ animationMs: v })}
          format={(v) => (v === 0 ? 'Off' : `${v}ms`)}
        />
      </Section>
    </>
  )
}

function PiecesTab(): React.JSX.Element {
  const settings = useSettings()
  const updateSettings = useStore((s) => s.updateSettings)
  const colors = useBoardColors()
  const pieceColors = usePieceColors()
  const selected = PIECE_SETS.find((s) => s.id === settings.pieceSetId)

  const setColors = (patch: Partial<typeof pieceColors>): void => {
    void updateSettings({ pieceColors: { ...pieceColors, ...patch } })
  }

  return (
    <>
      <Section
        title="Piece colours"
        description="Recolours whichever set is selected. Shading is preserved, so the detailed sets keep their depth."
        actions={
          pieceColors.enabled && (
            <button
              className="btn btn-ghost text-xs"
              onClick={() => setColors(COLOR_PRESETS[0])}
              title="Back to Ivory & Ebony"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )
        }
      >
        <Toggle
          label="Recolour pieces"
          hint="Off uses each set's original artwork"
          checked={pieceColors.enabled}
          onChange={(v) => setColors({ enabled: v })}
        />

        {pieceColors.enabled && (
          <>
            <div className="grid grid-cols-4 gap-2 my-3">
              {COLOR_PRESETS.map((preset) => {
                const active =
                  pieceColors.white.piece === preset.white.piece &&
                  pieceColors.black.piece === preset.black.piece
                return (
                  <button
                    key={preset.id}
                    onClick={() => setColors({ white: preset.white, black: preset.black })}
                    className="rounded-lg overflow-hidden text-left transition-all"
                    style={{
                      border: `2px solid ${active ? 'var(--color-accent-500)' : 'var(--border-subtle)'}`
                    }}
                    title={preset.name}
                  >
                    <div className="flex" style={{ height: 26 }}>
                      <div className="flex-1" style={{ background: preset.white.piece }} />
                      <div style={{ width: 6, background: preset.white.outline }} />
                      <div className="flex-1" style={{ background: preset.black.piece }} />
                      <div style={{ width: 6, background: preset.black.outline }} />
                    </div>
                    <div className="px-2 py-1 text-xs truncate" style={{ background: 'var(--surface-2)' }}>
                      {preset.name}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="label mt-4 mb-1">White pieces</div>
            <ColorField
              label="Piece"
              hint="The body of the piece"
              value={pieceColors.white.piece}
              onChange={(v) => setColors({ white: { ...pieceColors.white, piece: v } })}
            />
            <ColorField
              label="Outline"
              hint="Edges and interior lines"
              value={pieceColors.white.outline}
              onChange={(v) => setColors({ white: { ...pieceColors.white, outline: v } })}
            />

            <div className="label mt-4 mb-1">Black pieces</div>
            <ColorField
              label="Piece"
              hint="The body of the piece"
              value={pieceColors.black.piece}
              onChange={(v) => setColors({ black: { ...pieceColors.black, piece: v } })}
            />
            <ColorField
              label="Outline"
              hint="Edges and interior highlights"
              value={pieceColors.black.outline}
              onChange={(v) => setColors({ black: { ...pieceColors.black, outline: v } })}
            />

            <div className="mt-3">
              <Toggle
                label="Recolour accents too"
                hint="Off keeps deliberate colours — a bunny's pink ears, a Firi crest — as the artist drew them"
                checked={pieceColors.tintAccents}
                onChange={(v) => setColors({ tintAccents: v })}
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Piece set" description={`${PIECE_SETS.length} sets, from classic Staunton to pixel art.`}>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          {PIECE_SETS.map((set) => {
            const active = settings.pieceSetId === set.id
            return (
              <button
                key={set.id}
                onClick={() => void updateSettings({ pieceSetId: set.id })}
                className="rounded-lg p-3 text-left transition-all"
                style={{
                  border: `2px solid ${active ? 'var(--color-accent-500)' : 'var(--border-subtle)'}`,
                  background: active ? 'var(--surface-2)' : 'var(--surface-1)'
                }}
              >
                <SetPreview setId={set.id} background={colors.light} />
                <div className="text-sm font-semibold truncate">{set.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                  {set.author}
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      {selected && (
        <Section title="Credits">
          <div className="text-sm">
            <span className="font-semibold">{selected.name}</span> by {selected.author}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Licence: {selected.license}
          </div>
          {selected.nonCommercial && (
            <div
              className="flex items-start gap-2 mt-3 p-3 rounded-lg text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--color-warn-400)' }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                This set is licensed for non-commercial use only. Fine for personal play, but it cannot be
                included if this app is ever sold or distributed commercially.
              </span>
            </div>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            All piece art comes from the Lichess project. Full licence notices are bundled with the app in
            pieces/COPYING.md.
          </p>
        </Section>
      )}
    </>
  )
}

/** Row of white pieces for one set, recoloured to match current settings. */
function SetPreview({ setId, background }: { setId: string; background: string }): React.JSX.Element {
  const resolvePiece = usePieceResolver(setId, usePieceColors())
  return (
    <div
      className="flex items-center justify-center gap-0.5 rounded mb-2 px-1"
      style={{ background, height: 44 }}
    >
      {PREVIEW_ORDER.map((piece) => (
        <img
          key={piece}
          src={resolvePiece('w', piece)}
          alt=""
          className="no-drag"
          style={{ width: 30, height: 30 }}
        />
      ))}
    </div>
  )
}

function PlayTab(): React.JSX.Element {
  const settings = useSettings()
  const updateSettings = useStore((s) => s.updateSettings)

  return (
    <>
      <Section title="Moving pieces">
        <div className="py-2">
          <div className="text-sm mb-2">Move input</div>
          <div className="flex gap-2">
            {(
              [
                { id: 'both', label: 'Drag or click' },
                { id: 'drag', label: 'Drag only' },
                { id: 'click', label: 'Click only' }
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                onClick={() => void updateSettings({ moveInput: option.id })}
                className="btn flex-1"
                style={
                  settings.moveInput === option.id
                    ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                    : undefined
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="Auto-promote to queen"
          hint="Skip the promotion picker. You can still underpromote by turning this off."
          checked={settings.autoPromoteToQueen}
          onChange={(v) => void updateSettings({ autoPromoteToQueen: v })}
        />
        <Toggle
          label="Confirm before resigning"
          checked={settings.confirmResign}
          onChange={(v) => void updateSettings({ confirmResign: v })}
        />
        <Toggle
          label="Show the evaluation bar"
          hint="Live engine assessment beside the board while you play"
          checked={settings.showEvalBar}
          onChange={(v) => void updateSettings({ showEvalBar: v })}
        />
      </Section>

      <Section title="Clock" description="Applies to timed games; the pace itself is chosen on the Play screen.">
        <Slider
          label="Low-time warning"
          value={settings.lowTimeWarningSec}
          min={0}
          max={60}
          step={5}
          onChange={(v) => void updateSettings({ lowTimeWarningSec: v })}
          format={(v) => (v === 0 ? 'Off' : `${v}s`)}
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          The clock turns amber at this point, red at half of it, and plays a cue once per side.
        </p>
      </Section>

      <Section title="Sound">
        <Toggle
          label="Sound effects"
          hint="Move, capture, and check cues, synthesised on the fly"
          checked={settings.soundEnabled}
          onChange={(v) => {
            void updateSettings({ soundEnabled: v })
            if (v) play('move')
          }}
        />
        <Slider
          label="Volume"
          value={Math.round(settings.soundVolume * 100)}
          min={0}
          max={100}
          step={5}
          onChange={(v) => {
            void updateSettings({ soundVolume: v / 100 })
            play('move')
          }}
          format={(v) => `${v}%`}
        />
      </Section>

      <Section title="Appearance">
        <div className="py-2">
          <div className="text-sm mb-2">App theme</div>
          <div className="flex gap-2">
            {(['dark', 'light', 'system'] as const).map((option) => (
              <button
                key={option}
                onClick={() => void updateSettings({ theme: option })}
                className="btn flex-1 capitalize"
                style={
                  settings.theme === option
                    ? { borderColor: 'var(--color-accent-500)', background: 'var(--surface-3)' }
                    : undefined
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </Section>
    </>
  )
}

function EngineTab(): React.JSX.Element {
  const settings = useSettings()
  const updateSettings = useStore((s) => s.updateSettings)
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.chess.app.info>> | null>(null)

  useEffect(() => {
    void window.chess.app.info().then(setInfo)
  }, [])

  return (
    <>
      {/*
        The browser engine is a single-threaded WASM build with a fixed 16MB
        hash, so there is nothing here to tune. Showing dead sliders would be
        worse than showing none.
      */}
      {IS_WEB ? (
        <Section title="Engine" description="Stockfish, compiled to WebAssembly.">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The web engine runs on one thread with a 16MB hash table, both fixed by the build, so
            there is nothing to configure. It is meaningfully slower than the desktop app&rsquo;s
            native Stockfish, and every opponent&rsquo;s strength is emulated by searching shallowly
            and choosing among several candidate moves. The bots play as their rating suggests; the
            engine itself is not at full strength.
          </p>
        </Section>
      ) : (
        <Section
          title="Engine resources"
          description="Applies the next time an engine starts — restart the app to be sure."
        >
          <Slider
            label="Threads"
            value={settings.engineThreads}
            min={1}
            max={16}
            onChange={(v) => void updateSettings({ engineThreads: v })}
            format={(v) => `${v} thread${v > 1 ? 's' : ''}`}
          />
          <Slider
            label="Hash table"
            value={settings.engineHashMb}
            min={16}
            max={4096}
            step={16}
            onChange={(v) => void updateSettings({ engineHashMb: v })}
            format={(v) => `${v} MB`}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            These affect analysis only. Opponents deliberately run on a single thread so a weak bot
            cannot accidentally out-calculate its rating.
          </p>
        </Section>
      )}

      {info && (
        <Section title="About">
          <dl className="text-xs grid grid-cols-[8rem_1fr] gap-y-1.5 selectable">
            <dt style={{ color: 'var(--text-muted)' }}>Version</dt>
            <dd>{info.version}</dd>
            {/* Empty in the browser, where there is no Electron or Node. */}
            {info.electron && (
              <>
                <dt style={{ color: 'var(--text-muted)' }}>Electron</dt>
                <dd>{info.electron}</dd>
              </>
            )}
            {info.node && (
              <>
                <dt style={{ color: 'var(--text-muted)' }}>Node</dt>
                <dd>{info.node}</dd>
              </>
            )}
            <dt style={{ color: 'var(--text-muted)' }}>Chromium</dt>
            <dd className="truncate">{info.chrome}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Engine</dt>
            <dd className="truncate">{info.enginePath}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Puzzles</dt>
            <dd className="truncate">{info.puzzleDbPath ?? 'not built'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Profile</dt>
            <dd className="truncate">{info.profilePath}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Storage</dt>
            <dd className="truncate">{info.userData}</dd>
          </dl>

          {/* A browser in private mode can refuse storage outright. The app
              still runs, so say plainly that nothing will be kept. */}
          {info.platform === 'web' && !info.userData.startsWith('Browser storage') && (
            <div
              className="flex items-start gap-2 mt-3 p-3 rounded-lg text-xs"
              style={{ background: 'var(--surface-2)', color: 'var(--color-warn-400)' }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                This browser will not let the app store data, so your ratings, games, and settings
                will be lost when you close the tab. Private browsing is the usual cause.
              </span>
            </div>
          )}
        </Section>
      )}

      <Section title="Credits">
        <div className="text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <p>
            <span className="font-semibold">Stockfish</span> — the chess engine, licensed GPLv3. Bundled
            unmodified.
          </p>
          <p>
            <span className="font-semibold">Lichess puzzle database</span> — over six million positions,
            released under CC0.
          </p>
          <p>
            <span className="font-semibold">Lichess piece sets</span> — licences vary per set; see the Pieces
            tab.
          </p>
        </div>
      </Section>
    </>
  )
}

/**
 * Bulk-downloads the puzzle set for offline play.
 *
 * Rating bands are fetched lazily by design — the install is 4MB rather than
 * 19MB — but that means a player who goes offline only has the bands they
 * happen to have visited. This makes the trade explicit and reversible.
 */
function OfflineSection(): React.JSX.Element | null {
  const [status, setStatus] = useState<{ ready: number; total: number; bytes: number } | null>(null)
  const [totalMb, setTotalMb] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = window.chessOffline
    if (!api) return
    try {
      setStatus(await api.status())
      // Estimate from the real puzzle count rather than a number baked in
      // here that goes stale the moment the export changes.
      const stats = await window.chess.puzzles.stats()
      setTotalMb(Math.round((stats.total * 138) / 1e6))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!window.chessOffline) return null

  const download = async (): Promise<void> => {
    setError(null)
    setProgress({ done: 0, total: status?.total ?? 1 })
    try {
      await window.chessOffline!.downloadAll((done, total) => setProgress({ done, total }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  const complete = status != null && status.ready >= status.total

  return (
    <Section
      title="Offline puzzles"
      description="Puzzles download as you play. Fetch them all to play with no connection."
    >
      {status && (
        <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          <span className="tabular font-semibold">
            {status.ready} of {status.total}
          </span>{' '}
          rating bands stored
          {complete ? ' — the full set is available offline.' : '.'}
        </div>
      )}

      {progress && (
        <div className="mb-3">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--surface-3)' }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.round((progress.done / progress.total) * 100)}%`,
                background: 'var(--color-accent-500)'
              }}
            />
          </div>
          <div className="text-xs mt-1.5 tabular" style={{ color: 'var(--text-muted)' }}>
            Downloading {progress.done} of {progress.total}…
          </div>
        </div>
      )}

      <button
        className="btn w-full"
        onClick={() => void download()}
        disabled={progress != null || complete}
      >
        <Download size={15} />
        {complete
          ? 'All puzzles stored'
          : progress
            ? 'Downloading…'
            : totalMb
              ? `Download all puzzles (~${totalMb} MB)`
              : 'Download all puzzles'}
      </button>

      {error && (
        <div className="text-xs mt-2" style={{ color: 'var(--color-danger-400)' }}>
          {error}
        </div>
      )}

      <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Stored in the browser&rsquo;s cache, which clearing site data will empty. The daily puzzle and
        the app itself already work offline without this.
      </p>
    </Section>
  )
}

function ProfileTab(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)
  const refreshProfile = useStore((s) => s.refreshProfile)
  const [name, setName] = useState(profile?.displayName ?? 'Player')
  const [message, setMessage] = useState<string | null>(null)

  const onExport = async (): Promise<void> => {
    const result = await window.chess.profile.export()
    setMessage(result.ok ? `Saved to ${result.path}` : result.reason === 'canceled' ? null : `Failed: ${result.reason}`)
  }

  const onImport = async (): Promise<void> => {
    const result = await window.chess.profile.import()
    if (result.ok && result.profile) {
      setProfile(result.profile)
      setName(result.profile.displayName)
      setMessage('Profile imported.')
    } else if (result.reason !== 'canceled') {
      setMessage(`Failed: ${result.reason}`)
    }
  }

  const onReset = async (): Promise<void> => {
    if (!window.confirm('Erase all ratings, games, puzzle history, and lesson progress? This cannot be undone.')) {
      return
    }
    const fresh = await window.chess.profile.reset()
    setProfile(fresh)
    setName(fresh.displayName)
    setMessage('Profile reset.')
  }

  return (
    <>
      <Section title="Player">
        <label className="block py-2">
          <div className="text-sm mb-1.5">Display name</div>
          <input
            className="input"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => {
              await window.chess.profile.setDisplayName(name)
              await refreshProfile()
            }}
          />
        </label>
      </Section>

      <Section
        title="Backup"
        description="Everything lives on this machine — there is no account and nothing is uploaded."
      >
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={onExport}>
            <Download size={15} /> Export profile
          </button>
          <button className="btn flex-1" onClick={onImport}>
            <Upload size={15} /> Import profile
          </button>
        </div>
        {message && (
          <div className="flex items-start gap-2 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Info size={13} className="shrink-0 mt-0.5" />
            <span className="selectable break-all">{message}</span>
          </div>
        )}
      </Section>

      <OfflineSection />

      <Section title="Danger zone">
        <button className="btn btn-danger w-full" onClick={onReset}>
          <RotateCcw size={15} /> Reset all progress
        </button>
      </Section>
    </>
  )
}
