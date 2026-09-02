/**
 * The opponent ladder.
 *
 * Every rung is a rating Maia-3 was actually trained on, which is why the
 * blurbs describe *how* an opponent plays rather than how hard it is. These are
 * not one engine handicapped in twelve ways: the model predicts what a human of
 * each rating really plays, so a 700 hangs pieces the way a 700 does rather
 * than playing well and then throwing a piece away at random.
 *
 * The range is fixed by the model. Maia-3 covers 600 to 2600; asking for
 * anything outside that extrapolates into behaviour nobody trained or tested,
 * so the ladder stops where the training data does.
 */

import { MAIA_MAX_ELO, MAIA_MIN_ELO } from '@shared/maia'

export interface Bot {
  id: string
  name: string
  elo: number
  /** One-line description of how this opponent behaves. */
  blurb: string
  /** Thinking time per move, in milliseconds. */
  moveTimeMs: number
  tier: 'beginner' | 'casual' | 'club' | 'expert' | 'master'
}

/**
 * A forward pass takes a few milliseconds, so these are pacing, not compute.
 * An opponent that answers instantly at every rating feels wrong, and a beginner
 * who replies faster than you can let go of the piece feels worse.
 */
export const BOTS: Bot[] = [
  {
    id: 'pawn',
    name: 'Pip',
    elo: 600,
    blurb: 'Just past the rules. Hangs pieces constantly and misses simple threats.',
    moveTimeMs: 400,
    tier: 'beginner'
  },
  {
    id: 'sprout',
    name: 'Sprout',
    elo: 800,
    blurb: 'Knows how the pieces move. Grabs material greedily and forgets about defence.',
    moveTimeMs: 450,
    tier: 'beginner'
  },
  {
    id: 'scout',
    name: 'Scout',
    elo: 1000,
    blurb: 'Spots one-move threats. Still walks into forks and back-rank tricks.',
    moveTimeMs: 500,
    tier: 'beginner'
  },
  {
    id: 'rookie',
    name: 'Rookie',
    elo: 1200,
    blurb: 'Develops pieces and castles. Tactics beyond two moves go straight past them.',
    moveTimeMs: 550,
    tier: 'casual'
  },
  {
    id: 'cadet',
    name: 'Cadet',
    elo: 1400,
    blurb: 'Plays sensible openings and punishes obvious blunders.',
    moveTimeMs: 600,
    tier: 'casual'
  },
  {
    id: 'clubber',
    name: 'Mira',
    elo: 1600,
    blurb: 'A solid club player. Rarely hangs material and finds short tactics.',
    moveTimeMs: 650,
    tier: 'club'
  },
  {
    id: 'tactician',
    name: 'Volt',
    elo: 1800,
    blurb: 'Sharp and tactical. Will make you pay for a loose piece.',
    moveTimeMs: 700,
    tier: 'club'
  },
  {
    id: 'strategist',
    name: 'Anchor',
    elo: 2000,
    blurb: 'Positional and patient. Squeezes small advantages into winning endgames.',
    moveTimeMs: 750,
    tier: 'club'
  },
  {
    id: 'expert',
    name: 'Corvid',
    elo: 2200,
    blurb: 'Strong all-rounder. Punishes inaccuracies you will not even notice.',
    moveTimeMs: 800,
    tier: 'expert'
  },
  {
    id: 'candidate',
    name: 'Vesper',
    elo: 2400,
    blurb: 'Candidate-master strength. Long-term plans and precise calculation.',
    moveTimeMs: 900,
    tier: 'expert'
  },
  {
    id: 'master',
    name: 'Sable',
    elo: 2600,
    blurb: 'The strongest human play the model has seen. Expect no gifts.',
    moveTimeMs: 1000,
    tier: 'master'
  }
]

export const TIER_LABELS: Record<Bot['tier'], string> = {
  beginner: 'Learning the ropes',
  casual: 'Casual',
  club: 'Club strength',
  expert: 'Expert',
  master: 'Master'
}

export const TIER_ORDER: Bot['tier'][] = ['beginner', 'casual', 'club', 'expert', 'master']

/** The rating range the opponents actually cover, straight from the model. */
export const BOT_MIN_ELO = MAIA_MIN_ELO
export const BOT_MAX_ELO = MAIA_MAX_ELO

export function getBot(id: string): Bot {
  return BOTS.find((b) => b.id === id) ?? BOTS[4]
}

/** The bot closest to a given rating, used to suggest a fair opponent. */
export function suggestBot(rating: number): Bot {
  return BOTS.reduce((best, bot) =>
    Math.abs(bot.elo - rating) < Math.abs(best.elo - rating) ? bot : best
  )
}
