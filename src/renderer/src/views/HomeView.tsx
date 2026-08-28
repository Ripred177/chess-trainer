import { useEffect, useMemo, useState } from 'react'
import { Swords, Puzzle as PuzzleIcon, CalendarDays, GraduationCap, Flame } from 'lucide-react'
import type { PuzzleStats } from '@shared/types'
import { PageHeader, Stat } from '../components/ui'
import { useStore } from '../state/useStore'
import { suggestedModule } from '../data/curriculum'
import { themeMeta, HIDDEN_THEMES } from '../data/puzzleThemes'
import { suggestBot } from '../data/bots'
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../data/timeControls'

export default function HomeView(): React.JSX.Element {
  const profile = useStore((s) => s.profile)
  const setView = useStore((s) => s.setView)
  const puzzlesAvailable = useStore((s) => s.puzzlesAvailable)
  const [stats, setStats] = useState<PuzzleStats | null>(null)

  useEffect(() => {
    if (!puzzlesAvailable) return
    void window.chess.puzzles.stats().then(setStats)
  }, [puzzlesAvailable])

  const puzzleRating = profile?.puzzleRating.rating ?? 1200
  const playRating = profile?.playRating.rating ?? 1200

  const recent = useMemo(() => (profile?.attempts ?? []).slice(-40).reverse(), [profile])
  const solvedRecently = recent.filter((a) => a.solved).length

  /** Themes where the player is clearly under their overall rating. */
  const weakThemes = useMemo(() => {
    const entries = Object.entries(profile?.themeRatings ?? {})
      .filter(([theme, r]) => !HIDDEN_THEMES.has(theme) && r.plays >= 5)
      .map(([theme, r]) => ({ theme, rating: r.rating, plays: r.plays, gap: r.rating - puzzleRating }))
      .sort((a, b) => a.gap - b.gap)
    return entries.slice(0, 4).filter((e) => e.gap < -30)
  }, [profile, puzzleRating])

  const strongThemes = useMemo(() => {
    return Object.entries(profile?.themeRatings ?? {})
      .filter(([theme, r]) => !HIDDEN_THEMES.has(theme) && r.plays >= 5)
      .map(([theme, r]) => ({ theme, rating: r.rating, gap: r.rating - puzzleRating }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 4)
      .filter((e) => e.gap > 30)
  }, [profile, puzzleRating])

  // Only show paces the player has actually used; five 1200s says nothing.
  const playedPaces = useMemo(
    () =>
      CATEGORY_ORDER.map((pace) => ({ pace, record: profile?.paceRatings?.[pace] })).filter(
        (entry): entry is { pace: (typeof CATEGORY_ORDER)[number]; record: NonNullable<typeof entry.record> } =>
          Boolean(entry.record && entry.record.plays > 0)
      ),
    [profile]
  )

  const nextModule = suggestedModule(puzzleRating)
  const fairOpponent = suggestBot(playRating)
  const today = new Date().toISOString().slice(0, 10)
  const dailyDone = Boolean(profile?.daily[today])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title={`Welcome back, ${profile?.displayName ?? 'Player'}`}
        subtitle={
          stats
            ? `${stats.total.toLocaleString()} puzzles ready, and Stockfish 18 standing by.`
            : 'Everything runs locally on this machine.'
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat
          label="Puzzle rating"
          value={puzzleRating}
          sub={`${profile?.puzzleRating.plays ?? 0} solved`}
        />
        <Stat label="Game rating" value={playRating} sub={`${profile?.games.length ?? 0} games`} />
        <Stat
          label="Daily streak"
          value={profile?.streak.current ?? 0}
          sub={`best ${profile?.streak.longest ?? 0}`}
          tone={(profile?.streak.current ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Stat
          label="Recent form"
          value={recent.length > 0 ? `${Math.round((solvedRecently / recent.length) * 100)}%` : '—'}
          sub={recent.length > 0 ? `last ${recent.length} puzzles` : 'no attempts yet'}
          tone={recent.length > 0 && solvedRecently / recent.length >= 0.6 ? 'good' : 'default'}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <ActionCard
          icon={<CalendarDays size={18} />}
          title={dailyDone ? 'Daily puzzle — done' : 'Daily puzzle'}
          body={
            dailyDone
              ? `You have played today's puzzle. Streak: ${profile?.streak.current ?? 0} days.`
              : 'A new puzzle every day, the same one on every machine. Keep the streak alive.'
          }
          cta={dailyDone ? 'Review it' : 'Solve today’s puzzle'}
          onClick={() => setView('daily')}
          highlight={!dailyDone}
        />
        <ActionCard
          icon={<PuzzleIcon size={18} />}
          title="Train tactics"
          body={`Puzzles served at your level, or filtered by any of ${
            stats?.themes.length ?? 70
          } motifs.`}
          cta="Start solving"
          onClick={() => setView('puzzles')}
        />
        <ActionCard
          icon={<Swords size={18} />}
          title="Play a game"
          body={`${fairOpponent.name} at ${fairOpponent.elo} looks like a fair match right now.`}
          cta="Choose an opponent"
          onClick={() => setView('play')}
        />
        <ActionCard
          icon={<GraduationCap size={18} />}
          title="Next lesson"
          body={`${nextModule.title} — ${nextModule.blurb}`}
          cta="Open the curriculum"
          onClick={() => setView('learn')}
        />
      </div>

      {playedPaces.length > 0 && (
        <div className="card p-5 mb-3">
          <div className="label mb-3">Rating by pace</div>
          <div className="grid grid-cols-5 gap-3">
            {playedPaces.map(({ pace, record }) => (
              <div key={pace}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {CATEGORY_LABELS[pace]}
                </div>
                <div className="text-lg font-semibold tabular">{record.rating}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {record.plays} game{record.plays === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(weakThemes.length > 0 || strongThemes.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {weakThemes.length > 0 && (
            <div className="card p-5">
              <div className="label mb-3">Worth practising</div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                Motifs where you score below your overall rating.
              </p>
              {weakThemes.map((entry) => (
                <div key={entry.theme} className="flex items-center justify-between py-1.5">
                  <span className="text-sm">{themeMeta(entry.theme).name}</span>
                  <span className="text-sm tabular" style={{ color: 'var(--color-danger-400)' }}>
                    {entry.rating}
                  </span>
                </div>
              ))}
            </div>
          )}

          {strongThemes.length > 0 && (
            <div className="card p-5">
              <div className="label mb-3">Your strengths</div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                Motifs you find faster than the rest.
              </p>
              {strongThemes.map((entry) => (
                <div key={entry.theme} className="flex items-center justify-between py-1.5">
                  <span className="text-sm">{themeMeta(entry.theme).name}</span>
                  <span className="text-sm tabular" style={{ color: 'var(--color-accent-400)' }}>
                    {entry.rating}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {recent.length === 0 && (
        <div className="card p-5 flex items-start gap-3">
          <Flame size={18} style={{ color: 'var(--color-warn-400)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="text-sm font-semibold">Nothing recorded yet</div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Solve a few puzzles and your rating will settle quickly — it starts uncertain and tightens as you
              go. Everything is stored on this machine only.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionCard({
  icon,
  title,
  body,
  cta,
  onClick,
  highlight
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  onClick: () => void
  highlight?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="card p-5 text-left transition-all"
      style={{ borderColor: highlight ? 'var(--color-accent-500)' : 'var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
        {icon}
        <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </p>
      <span
        className="inline-block text-xs font-semibold mt-3"
        style={{ color: 'var(--color-accent-400)' }}
      >
        {cta} →
      </span>
    </button>
  )
}
