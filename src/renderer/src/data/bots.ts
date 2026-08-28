/**
 * The opponent ladder.
 *
 * Ratings below 1320 are emulated in the main process (Stockfish's own limiter
 * stops there), which is why the low end of this list gets a personality
 * describing *how* it plays badly — that is the part players actually notice.
 */

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

export const BOTS: Bot[] = [
  {
    id: 'pawn',
    name: 'Pip',
    elo: 300,
    blurb: 'Just learned the rules. Hangs pieces constantly and misses simple threats.',
    moveTimeMs: 120,
    tier: 'beginner'
  },
  {
    id: 'sprout',
    name: 'Sprout',
    elo: 500,
    blurb: 'Knows how the pieces move. Grabs material greedily and forgets about defence.',
    moveTimeMs: 150,
    tier: 'beginner'
  },
  {
    id: 'scout',
    name: 'Scout',
    elo: 700,
    blurb: 'Spots one-move threats. Still walks into forks and back-rank tricks.',
    moveTimeMs: 180,
    tier: 'beginner'
  },
  {
    id: 'rookie',
    name: 'Rookie',
    elo: 900,
    blurb: 'Develops pieces and castles. Tactics beyond two moves go straight past them.',
    moveTimeMs: 220,
    tier: 'casual'
  },
  {
    id: 'cadet',
    name: 'Cadet',
    elo: 1100,
    blurb: 'Plays sensible openings and punishes obvious blunders.',
    moveTimeMs: 260,
    tier: 'casual'
  },
  {
    id: 'clubber',
    name: 'Mira',
    elo: 1320,
    blurb: 'A solid club player. Rarely hangs material and finds short tactics.',
    moveTimeMs: 300,
    tier: 'club'
  },
  {
    id: 'tactician',
    name: 'Volt',
    elo: 1600,
    blurb: 'Sharp and tactical. Will make you pay for a loose piece.',
    moveTimeMs: 400,
    tier: 'club'
  },
  {
    id: 'strategist',
    name: 'Anchor',
    elo: 1800,
    blurb: 'Positional and patient. Squeezes small advantages into winning endgames.',
    moveTimeMs: 500,
    tier: 'club'
  },
  {
    id: 'expert',
    name: 'Corvid',
    elo: 2000,
    blurb: 'Strong all-rounder. Punishes inaccuracies you will not even notice.',
    moveTimeMs: 700,
    tier: 'expert'
  },
  {
    id: 'candidate',
    name: 'Vesper',
    elo: 2200,
    blurb: 'Candidate-master strength. Long-term plans and precise calculation.',
    moveTimeMs: 900,
    tier: 'expert'
  },
  {
    id: 'master',
    name: 'Sable',
    elo: 2400,
    blurb: 'Master level. Expect no gifts and relentless technique.',
    moveTimeMs: 1200,
    tier: 'master'
  },
  {
    id: 'grandmaster',
    name: 'Obsidian',
    elo: 2700,
    blurb: 'Grandmaster strength. Winning requires a near-perfect game.',
    moveTimeMs: 1600,
    tier: 'master'
  },
  {
    id: 'engine',
    name: 'Stockfish',
    elo: 3190,
    blurb: 'The engine, unleashed. Nobody beats this — play it to learn, not to win.',
    moveTimeMs: 2000,
    tier: 'master'
  }
]

export const TIER_LABELS: Record<Bot['tier'], string> = {
  beginner: 'Learning the ropes',
  casual: 'Casual',
  club: 'Club strength',
  expert: 'Expert',
  master: 'Master and beyond'
}

export const TIER_ORDER: Bot['tier'][] = ['beginner', 'casual', 'club', 'expert', 'master']

export function getBot(id: string): Bot {
  return BOTS.find((b) => b.id === id) ?? BOTS[4]
}

/** The bot closest to a given rating, used to suggest a fair opponent. */
export function suggestBot(rating: number): Bot {
  return BOTS.reduce((best, bot) =>
    Math.abs(bot.elo - rating) < Math.abs(best.elo - rating) ? bot : best
  )
}
