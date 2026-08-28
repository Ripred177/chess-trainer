import { useEffect, useState } from 'react'
import {
  Home,
  Swords,
  Puzzle as PuzzleIcon,
  CalendarDays,
  GraduationCap,
  Dumbbell,
  Microscope,
  Users,
  History,
  MoreHorizontal,
  Settings as SettingsIcon,
  AlertTriangle
} from 'lucide-react'
import { IS_WEB, useStore, useViewport, type ViewId } from './state/useStore'
import HomeView from './views/HomeView'
import PlayView from './views/PlayView'
import PuzzlesView from './views/PuzzlesView'
import DailyView from './views/DailyView'
import LearnView from './views/LearnView'
import TrainView from './views/TrainView'
import AnalysisView from './views/AnalysisView'
import FriendsView from './views/FriendsView'
import GamesView from './views/GamesView'
import SettingsView from './views/SettingsView'

type NavItem = { id: ViewId; label: string; icon: typeof Home; hint: string }

const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, hint: 'Overview and progress' },
  { id: 'play', label: 'Play', icon: Swords, hint: 'Play a game against the engine' },
  { id: 'puzzles', label: 'Puzzles', icon: PuzzleIcon, hint: 'Train on millions of tactics' },
  { id: 'daily', label: 'Daily', icon: CalendarDays, hint: "Today's puzzle and your streak" },
  { id: 'learn', label: 'Learn', icon: GraduationCap, hint: 'Lessons from beginner to expert' },
  { id: 'train', label: 'Train', icon: Dumbbell, hint: 'Woodpecker, endgames, openings, studies' },
  { id: 'games', label: 'Games', icon: History, hint: 'Replay, export, and review your games' },
  { id: 'friends', label: 'Friends', icon: Users, hint: 'Play someone on your network' },
  { id: 'analysis', label: 'Analysis', icon: Microscope, hint: 'Analyse any position with Stockfish' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, hint: 'Board, pieces, and engine' }
]

/**
 * Two sections cannot work in a browser and are dropped from the web build
 * rather than shown as screens that can only fail:
 *
 * - Friends needs a listening socket and UDP multicast for discovery.
 * - Train needs the SQLite opening index and a strong local engine, neither of
 *   which the web export carries.
 */
const WEB_EXCLUDED: ViewId[] = ['friends', 'train']

const SECTIONS = IS_WEB ? NAV.filter((item) => !WEB_EXCLUDED.includes(item.id)) : NAV

/**
 * A phone tab bar holds about five items before the labels stop being
 * readable, so the rest move behind a "More" sheet — the usual arrangement on
 * both platforms. The sidebar on a wide screen still lists everything.
 */
const PRIMARY_IDS: ViewId[] = ['home', 'play', 'puzzles', 'daily']
const PRIMARY = SECTIONS.filter((item) => PRIMARY_IDS.includes(item.id))
const SECONDARY = SECTIONS.filter((item) => !PRIMARY_IDS.includes(item.id))

export default function App(): React.JSX.Element {
  const { ready, loadError, view, setView, init, profile } = useStore()
  const { narrow } = useViewport()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Number keys jump between sections, which is quicker than reaching for the
  // mouse when you are working through puzzles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMoreOpen(false)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const index = Number(e.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < SECTIONS.length) {
        setView(SECTIONS[index].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  // Growing the window past the breakpoint would otherwise strand the sheet.
  useEffect(() => {
    if (!narrow) setMoreOpen(false)
  }, [narrow])

  if (!ready) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-semibold tracking-tight">Chess Trainer</div>
          <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="h-full grid place-items-center p-8">
        <div className="card p-6 max-w-lg">
          <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--color-danger-400)' }}>
            <AlertTriangle size={18} />
            <span className="font-semibold">Could not start</span>
          </div>
          <p className="text-sm selectable" style={{ color: 'var(--text-secondary)' }}>
            {loadError}
          </p>
        </div>
      </div>
    )
  }

  // `pt-safe` keeps content out from under the notch, which viewport-fit=cover
  // otherwise lets it slide beneath.
  const body = (
    <main className="flex-1 overflow-auto pt-safe">
      {view === 'home' && <HomeView />}
      {view === 'play' && <PlayView />}
      {view === 'puzzles' && <PuzzlesView />}
      {view === 'daily' && <DailyView />}
      {view === 'learn' && <LearnView />}
      {view === 'train' && <TrainView />}
      {view === 'games' && <GamesView />}
      {view === 'friends' && <FriendsView />}
      {view === 'analysis' && <AnalysisView />}
      {view === 'settings' && <SettingsView />}
    </main>
  )

  if (narrow) {
    const inSheet = SECONDARY.some((item) => item.id === view)
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
        {body}

        {moreOpen && (
          <MoreSheet
            items={SECONDARY}
            current={view}
            profile={profile}
            onPick={(id) => {
              setView(id)
              setMoreOpen(false)
            }}
            onClose={() => setMoreOpen(false)}
          />
        )}

        <nav
          className="shrink-0 flex items-stretch border-t pb-safe"
          style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
        >
          {PRIMARY.map((item) => (
            <TabButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={view === item.id && !moreOpen}
              onClick={() => {
                setMoreOpen(false)
                setView(item.id)
              }}
            />
          ))}
          <TabButton
            icon={MoreHorizontal}
            label="More"
            active={moreOpen || inSheet}
            onClick={() => setMoreOpen((open) => !open)}
          />
        </nav>
      </div>
    )
  }

  return (
    <div className="h-full flex" style={{ background: 'var(--surface-0)' }}>
      <nav
        className="w-56 shrink-0 flex flex-col gap-1 p-3 border-r"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="px-2 py-3 mb-2">
          <div className="text-base font-semibold tracking-tight">Chess Trainer</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {profile?.displayName ?? 'Player'}
          </div>
        </div>

        {SECTIONS.map((item, i) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={`${item.hint}  (${i + 1})`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left"
              style={{
                background: active ? 'var(--surface-3)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'var(--surface-2)'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <Icon size={17} strokeWidth={2} />
              {item.label}
            </button>
          )
        })}

        <div className="mt-auto px-3 py-2">
          <RatingBadges />
        </div>
      </nav>

      {body}
    </div>
  )
}

/**
 * One slot in the phone tab bar. The 52px minimum clears Apple's 44pt target
 * guidance before the safe-area padding underneath is counted.
 */
function TabButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: typeof Home
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors"
      style={{
        minHeight: 52,
        color: active ? 'var(--color-accent-400)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 500
      }}
    >
      <Icon size={22} strokeWidth={active ? 2.4 : 2} />
      <span className="text-[10px] leading-none truncate max-w-full px-0.5">{label}</span>
    </button>
  )
}

/** The overflow menu, as a bottom sheet so it stays within thumb reach. */
function MoreSheet({
  items,
  current,
  profile,
  onPick,
  onClose
}: {
  items: NavItem[]
  current: ViewId
  profile: ReturnType<typeof useStore.getState>['profile']
  onPick: (id: ViewId) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      />

      <div
        className="relative rounded-t-2xl border-t px-3 pt-2 pb-safe-2"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-subtle)' }}
      >
        {/* The grabber is decorative, but its absence is what makes a sheet
            read as a web modal rather than a native one. */}
        <div
          className="mx-auto mb-3 rounded-full"
          style={{ width: 36, height: 4, background: 'var(--text-muted)', opacity: 0.4 }}
        />

        <div className="px-2 pb-2">
          <div className="text-sm font-semibold">{profile?.displayName ?? 'Player'}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Puzzles {profile?.puzzleRating.rating ?? '—'} · Games {profile?.playRating.rating ?? '—'}
            {profile && profile.streak.current > 0 ? ` · ${profile.streak.current}d streak` : ''}
          </div>
        </div>

        {items.map((item) => {
          const Icon = item.icon
          const active = current === item.id
          return (
            <button
              key={item.id}
              onClick={() => onPick(item.id)}
              className="w-full flex items-center gap-3 px-3 rounded-xl text-left"
              style={{
                minHeight: 52,
                background: active ? 'var(--surface-3)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500
              }}
            >
              <Icon size={20} strokeWidth={2} />
              <span className="flex-1">
                <span className="text-sm block">{item.label}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {item.hint}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RatingBadges(): React.JSX.Element | null {
  const profile = useStore((s) => s.profile)
  if (!profile) return null

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--text-muted)' }}>Puzzles</span>
        <span className="tabular font-semibold">{profile.puzzleRating.rating}</span>
      </div>
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--text-muted)' }}>Games</span>
        <span className="tabular font-semibold">{profile.playRating.rating}</span>
      </div>
      {profile.streak.current > 0 && (
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-muted)' }}>Streak</span>
          <span className="tabular font-semibold" style={{ color: 'var(--color-warn-400)' }}>
            {profile.streak.current}d
          </span>
        </div>
      )}
    </div>
  )
}
