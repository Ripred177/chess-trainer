import type { PuzzleQuery } from '@shared/types'

/**
 * Curated study sets for the middlegame, and the tactical motif groups the
 * Woodpecker builder offers.
 *
 * Each set is a *query*, not a fixed list — the same ten lines of definition
 * back thousands of positions, and the material never runs out. Themes are
 * Lichess puzzle-theme ids, so they match the database exactly.
 */

export interface StudySet {
  id: string
  title: string
  /** What this trains, and why it is worth the time. */
  blurb: string
  query: Omit<PuzzleQuery, 'limit' | 'seed' | 'minRating' | 'maxRating'>
  /** Rough rating from which this becomes useful. */
  fromRating: number
}

export interface StudyGroup {
  id: string
  title: string
  blurb: string
  sets: StudySet[]
}

export const MIDDLEGAME_GROUPS: StudyGroup[] = [
  {
    id: 'attacking',
    title: 'Attack',
    blurb:
      'Converting an initiative into something concrete. Most decisive games below master level are decided by whether an attack was found, not by strategy.',
    sets: [
      {
        id: 'king-hunt',
        title: 'Attacking the castled king',
        blurb: 'Sacrifices and breakthroughs against a king that has already castled.',
        query: { themes: ['kingsideAttack', 'sacrifice'] },
        fromRating: 1200
      },
      {
        id: 'exposed-king',
        title: 'Punishing an exposed king',
        blurb: 'The king is stuck in the centre or stripped of cover. Find the way through.',
        query: { themes: ['exposedKing', 'attackingF2F7'] },
        fromRating: 1000
      },
      {
        id: 'mating-nets',
        title: 'Mating nets',
        blurb: 'Forced mates of three moves and more — where calculation has to be exact.',
        query: { themes: ['mateIn3', 'mateIn4'] },
        fromRating: 1400
      },
      {
        id: 'named-mates',
        title: 'Named mating patterns',
        blurb: 'Boden, Anastasia, Arabian, smothered. Recognising the shape is most of the work.',
        query: { themes: ['smotheredMate', 'arabianMate', 'anastasiaMate', 'bodenMate', 'hookMate'] },
        fromRating: 1300
      }
    ]
  },
  {
    id: 'tactics',
    title: 'Tactical motifs',
    blurb:
      'The recurring shapes. Drilled individually rather than mixed, so the pattern rather than the puzzle is what sticks.',
    sets: [
      {
        id: 'forks-pins',
        title: 'Forks, pins and skewers',
        blurb: 'The three that decide most games under 1500.',
        query: { themes: ['fork', 'pin', 'skewer'] },
        fromRating: 800
      },
      {
        id: 'discovery',
        title: 'Discovered attacks',
        blurb: 'Moving one piece to unleash another — the hardest motif to see coming.',
        query: { themes: ['discoveredAttack', 'doubleCheck'] },
        fromRating: 1100
      },
      {
        id: 'deflection',
        title: 'Deflection and decoy',
        blurb: 'Dragging a defender off its job, or luring a piece onto a fatal square.',
        query: { themes: ['deflection', 'attraction', 'capturingDefender'] },
        fromRating: 1300
      },
      {
        id: 'quiet-moves',
        title: 'Quiet moves',
        blurb: 'The hardest to find: no check, no capture, and yet nothing can be done.',
        query: { themes: ['quietMove', 'zugzwang'] },
        fromRating: 1600
      },
      {
        id: 'intermezzo',
        title: 'In-between moves',
        blurb: 'Zwischenzug — inserting a threat before the "obvious" recapture.',
        query: { themes: ['intermezzo', 'clearance'] },
        fromRating: 1500
      }
    ]
  },
  {
    id: 'defence',
    title: 'Defence and resourcefulness',
    blurb:
      'Half of practical strength is not losing. These are the positions where the only move holds, or where a lost game is saved outright.',
    sets: [
      {
        id: 'only-moves',
        title: 'Defensive resources',
        blurb: 'One move holds. Find it under pressure rather than resigning to the threat.',
        query: { themes: ['defensiveMove'] },
        fromRating: 1300
      },
      {
        id: 'equality',
        title: 'Saving the draw',
        blurb: 'Positions where the best available result is a half point, and it has to be earned.',
        query: { themes: ['equality'] },
        fromRating: 1500
      },
      {
        id: 'trapped',
        title: 'Trapping pieces',
        blurb: 'A piece with no squares is as good as won material.',
        query: { themes: ['trappedPiece', 'hangingPiece'] },
        fromRating: 1000
      }
    ]
  },
  {
    id: 'endgame-play',
    title: 'Practical endgames',
    blurb:
      'Not theory — endgames as they actually arrive, where a tactic decides a position that looked technical.',
    sets: [
      {
        id: 'rook-endgames',
        title: 'Rook endgames',
        blurb: 'The most common ending there is, and the one most often misplayed.',
        query: { themes: ['rookEndgame'] },
        fromRating: 1200
      },
      {
        id: 'pawn-endgames',
        title: 'Pawn endgames',
        blurb: 'Where a single tempo is the whole game.',
        query: { themes: ['pawnEndgame'] },
        fromRating: 1000
      },
      {
        id: 'minor-endgames',
        title: 'Minor-piece endgames',
        blurb: 'Bishop and knight endings, where the difference between the two finally tells.',
        query: { themes: ['bishopEndgame', 'knightEndgame'] },
        fromRating: 1300
      },
      {
        id: 'promotion-race',
        title: 'Promotion and advanced pawns',
        blurb: 'Races, breakthroughs, and the under-promotions that decide them.',
        query: { themes: ['advancedPawn', 'promotion', 'underPromotion'] },
        fromRating: 1200
      }
    ]
  }
]

export const ALL_STUDY_SETS: StudySet[] = MIDDLEGAME_GROUPS.flatMap((g) => g.sets)

export function studySetById(id: string): StudySet | undefined {
  return ALL_STUDY_SETS.find((s) => s.id === id)
}

/**
 * Motif presets offered when building a Woodpecker set.
 *
 * The method's own advice is a broad mix rather than a narrow motif — you are
 * training recognition across the board, not one pattern — so "everything" is
 * the default and the rest are there for a deliberate weakness.
 */
export const WOODPECKER_PRESETS: { id: string; label: string; themes: string[] }[] = [
  { id: 'mixed', label: 'Everything (recommended)', themes: [] },
  { id: 'mates', label: 'Checkmates only', themes: ['mate'] },
  { id: 'material', label: 'Winning material', themes: ['crushing', 'advantage'] },
  { id: 'motifs', label: 'Core motifs', themes: ['fork', 'pin', 'skewer', 'discoveredAttack'] },
  { id: 'endgame', label: 'Endgame tactics', themes: ['endgame'] }
]

/**
 * Set sizes. Smith and Tikkanen used roughly a thousand positions over four
 * weeks; that is a serious commitment, so smaller sets are offered for people
 * who want the method without the sabbatical.
 */
export const WOODPECKER_SIZES: { size: number; label: string; note: string }[] = [
  { size: 100, label: '100', note: 'A fortnight of short sessions. Good for a first pass.' },
  { size: 250, label: '250', note: 'The usual starting point. Around a month per cycle.' },
  { size: 500, label: '500', note: 'Serious training. Expect several months in total.' },
  { size: 1000, label: '1000', note: 'The full method as the authors ran it.' }
]
