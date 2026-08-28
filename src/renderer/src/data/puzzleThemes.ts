/**
 * Human-readable metadata for the Lichess puzzle theme tags.
 *
 * The database stores raw tag ids such as `xRayAttack`; this maps them to a
 * name, a one-line explanation, and a category so the puzzle browser can group
 * them into something a learner can navigate.
 */

export type ThemeCategory = 'tactic' | 'mate' | 'endgame' | 'phase' | 'goal' | 'length' | 'special'

export interface ThemeMeta {
  id: string
  name: string
  description: string
  category: ThemeCategory
}

export const THEME_CATEGORIES: { id: ThemeCategory; label: string; blurb: string }[] = [
  { id: 'tactic', label: 'Tactical motifs', blurb: 'The patterns that win material' },
  { id: 'mate', label: 'Checkmate patterns', blurb: 'Named mating nets worth recognising instantly' },
  { id: 'endgame', label: 'Endgames', blurb: 'Positions with few pieces, where precision decides' },
  { id: 'phase', label: 'Game phase', blurb: 'Where in the game the position arises' },
  { id: 'goal', label: 'Objective', blurb: 'What the solution achieves' },
  { id: 'length', label: 'Length', blurb: 'How many moves the solution runs' },
  { id: 'special', label: 'Special moves', blurb: 'Rules and resources that are easy to overlook' }
]

const THEMES: ThemeMeta[] = [
  // ------------------------------------------------------------- tactics --
  { id: 'fork', name: 'Fork', description: 'One piece attacks two targets at once.', category: 'tactic' },
  { id: 'pin', name: 'Pin', description: 'A piece cannot move without exposing something more valuable.', category: 'tactic' },
  { id: 'skewer', name: 'Skewer', description: 'A valuable piece is attacked and must move, exposing the one behind it.', category: 'tactic' },
  { id: 'discoveredAttack', name: 'Discovered attack', description: 'Moving one piece unleashes an attack from the piece behind it.', category: 'tactic' },
  { id: 'doubleCheck', name: 'Double check', description: 'Two pieces give check at once, so the king must move.', category: 'tactic' },
  { id: 'hangingPiece', name: 'Hanging piece', description: 'An undefended piece can simply be taken.', category: 'tactic' },
  { id: 'trappedPiece', name: 'Trapped piece', description: 'A piece has no safe squares and cannot be saved.', category: 'tactic' },
  { id: 'deflection', name: 'Deflection', description: 'Force a defender away from the square it must guard.', category: 'tactic' },
  { id: 'attraction', name: 'Attraction', description: 'Lure a piece onto a square where it can be hit.', category: 'tactic' },
  { id: 'clearance', name: 'Clearance', description: 'Vacate a square or line so another piece can use it.', category: 'tactic' },
  { id: 'interference', name: 'Interference', description: 'Cut the line between a defender and what it defends.', category: 'tactic' },
  { id: 'intermezzo', name: 'In-between move', description: 'Insert a forcing move before the expected recapture.', category: 'tactic' },
  { id: 'xRayAttack', name: 'X-ray', description: 'A piece acts through another along a line.', category: 'tactic' },
  { id: 'capturingDefender', name: 'Remove the defender', description: 'Capture the piece that was holding everything together.', category: 'tactic' },
  { id: 'sacrifice', name: 'Sacrifice', description: 'Give up material for a decisive attack.', category: 'tactic' },
  { id: 'quietMove', name: 'Quiet move', description: 'A non-forcing move that creates an unstoppable threat.', category: 'tactic' },
  { id: 'defensiveMove', name: 'Defensive move', description: 'The only move that holds the position together.', category: 'tactic' },
  { id: 'zugzwang', name: 'Zugzwang', description: 'Every legal move makes the position worse.', category: 'tactic' },
  { id: 'exposedKing', name: 'Exposed king', description: 'The enemy king has lost its shelter.', category: 'tactic' },
  { id: 'kingsideAttack', name: 'Kingside attack', description: 'A direct assault on the castled king.', category: 'tactic' },
  { id: 'queensideAttack', name: 'Queenside attack', description: 'Pressure and breakthrough on the queenside.', category: 'tactic' },
  { id: 'attackingF2F7', name: 'Attacking f2 / f7', description: 'The weakest square in the opening position.', category: 'tactic' },
  { id: 'advancedPawn', name: 'Advanced pawn', description: 'A far-advanced pawn decides the position.', category: 'tactic' },

  // --------------------------------------------------------------- mates --
  { id: 'mate', name: 'Checkmate', description: 'The solution ends in mate.', category: 'mate' },
  { id: 'mateIn1', name: 'Mate in 1', description: 'One move ends it.', category: 'mate' },
  { id: 'mateIn2', name: 'Mate in 2', description: 'A forced mate two moves deep.', category: 'mate' },
  { id: 'mateIn3', name: 'Mate in 3', description: 'A forced mate three moves deep.', category: 'mate' },
  { id: 'mateIn4', name: 'Mate in 4', description: 'A forced mate four moves deep.', category: 'mate' },
  { id: 'mateIn5', name: 'Mate in 5 or more', description: 'A long forced mating sequence.', category: 'mate' },
  { id: 'backRankMate', name: 'Back-rank mate', description: 'The king is trapped behind its own pawns.', category: 'mate' },
  { id: 'smotheredMate', name: 'Smothered mate', description: 'A knight mates a king boxed in by its own pieces.', category: 'mate' },
  { id: 'anastasiaMate', name: "Anastasia's mate", description: 'Knight and rook trap the king against the edge.', category: 'mate' },
  { id: 'arabianMate', name: 'Arabian mate', description: 'Knight and rook mate a king in the corner.', category: 'mate' },
  { id: 'bodenMate', name: "Boden's mate", description: 'Two bishops on crossing diagonals deliver mate.', category: 'mate' },
  { id: 'dovetailMate', name: 'Dovetail mate', description: 'A queen mates a king whose escape squares are self-blocked.', category: 'mate' },
  { id: 'doubleBishopMate', name: 'Double bishop mate', description: 'Two bishops mate along adjacent diagonals.', category: 'mate' },
  { id: 'hookMate', name: 'Hook mate', description: 'Rook, knight, and pawn combine to seal the king in.', category: 'mate' },

  // ------------------------------------------------------------ endgames --
  { id: 'endgame', name: 'Endgame', description: 'Few pieces left; king activity matters.', category: 'endgame' },
  { id: 'pawnEndgame', name: 'Pawn endgame', description: 'Only kings and pawns. Calculation is everything.', category: 'endgame' },
  { id: 'rookEndgame', name: 'Rook endgame', description: 'The most common endgame in practice.', category: 'endgame' },
  { id: 'queenEndgame', name: 'Queen endgame', description: 'Queens on the board with few other pieces.', category: 'endgame' },
  { id: 'bishopEndgame', name: 'Bishop endgame', description: 'Bishops and pawns; colour complexes decide.', category: 'endgame' },
  { id: 'knightEndgame', name: 'Knight endgame', description: 'Knights and pawns; tempo and outposts matter.', category: 'endgame' },
  { id: 'queenRookEndgame', name: 'Queen and rook', description: 'Heavy pieces in the endgame.', category: 'endgame' },

  // --------------------------------------------------------------- phase --
  { id: 'opening', name: 'Opening', description: 'Arising in the first dozen moves.', category: 'phase' },
  { id: 'middlegame', name: 'Middlegame', description: 'The heart of the game, with most pieces still on.', category: 'phase' },

  // ---------------------------------------------------------------- goal --
  { id: 'crushing', name: 'Crushing', description: 'The solution wins decisively.', category: 'goal' },
  { id: 'advantage', name: 'Advantage', description: 'The solution gains a clear edge.', category: 'goal' },
  { id: 'equality', name: 'Equality', description: 'The only way to hold the balance.', category: 'goal' },

  // -------------------------------------------------------------- length --
  { id: 'oneMove', name: 'One move', description: 'A single move solves it.', category: 'length' },
  { id: 'short', name: 'Short', description: 'Two moves.', category: 'length' },
  { id: 'long', name: 'Long', description: 'Three moves.', category: 'length' },
  { id: 'veryLong', name: 'Very long', description: 'Four moves or more.', category: 'length' },

  // ------------------------------------------------------------- special --
  { id: 'promotion', name: 'Promotion', description: 'A pawn reaching the last rank decides.', category: 'special' },
  { id: 'underPromotion', name: 'Underpromotion', description: 'Promoting to something other than a queen is the only win.', category: 'special' },
  { id: 'enPassant', name: 'En passant', description: 'The pawn capture everyone forgets.', category: 'special' },
  { id: 'castling', name: 'Castling', description: 'Castling itself is the key move.', category: 'special' }
]

const BY_ID = new Map(THEMES.map((t) => [t.id, t]))

export const ALL_THEMES = THEMES

/** Metadata for a tag, synthesising something readable for unknown ids. */
export function themeMeta(id: string): ThemeMeta {
  const known = BY_ID.get(id)
  if (known) return known
  return {
    id,
    // Turn `superGM` into `Super GM` so unmapped tags still read sensibly.
    name: id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
    description: '',
    category: 'special'
  }
}

export function themesInCategory(category: ThemeCategory): ThemeMeta[] {
  return THEMES.filter((t) => t.category === category)
}

/**
 * Tags that describe provenance rather than content. They are real tags in the
 * dump but useless as training filters, so the browser hides them.
 */
export const HIDDEN_THEMES = new Set(['master', 'masterVsMaster', 'superGM', 'playerGames', 'healthyMix'])

// ----------------------------------------------------------------- hints ---

export interface PuzzleBrief {
  /** What the position is asking of you. */
  goal: string
  /**
   * The idea behind the position. A named motif when the tags carry one, and
   * otherwise advice fitted to the goal — "no motif" is unhelpful precisely
   * when someone has asked for help.
   */
  motif: string
  /**
   * How long your side of the solution runs. Empty when the goal already says
   * so — "Find the checkmate in two. You need to find two moves." reads badly.
   */
  length: string
}

/** Mate-in-N tags, longest first so the most specific claim wins. */
const MATE_IN: { theme: string; text: string }[] = [
  { theme: 'mateIn5', text: 'There is a forced mate here — five moves or more.' },
  { theme: 'mateIn4', text: 'Find the checkmate in four.' },
  { theme: 'mateIn3', text: 'Find the checkmate in three.' },
  { theme: 'mateIn2', text: 'Find the checkmate in two.' },
  { theme: 'mateIn1', text: 'Find the checkmate in one.' }
]

/**
 * Goals, most specific first. `crushing` and `advantage` are Lichess's own
 * measure of how large the winning margin is, which maps neatly onto how
 * emphatic the hint should be.
 */
const GOALS: { theme: string; text: string }[] = [
  { theme: 'mate', text: 'The line ends in checkmate.' },
  { theme: 'crushing', text: 'There is a winning continuation — expect to come out at least a piece ahead.' },
  { theme: 'advantage', text: 'There is a move here that wins material.' },
  { theme: 'equality', text: 'You are worse off. Only one move holds the balance.' },
  { theme: 'defensiveMove', text: 'You are under pressure — only one move holds the position together.' }
]

/**
 * Motifs worth naming, roughly most-telling first. Named mating patterns come
 * before general tactics because recognising the pattern *is* the lesson.
 */
const MOTIF_ORDER = [
  'smotheredMate', 'backRankMate', 'anastasiaMate', 'arabianMate', 'bodenMate',
  'hookMate', 'dovetailMate', 'doubleBishopMate',
  'fork', 'pin', 'skewer', 'discoveredAttack', 'doubleCheck', 'deflection',
  'attraction', 'clearance', 'interference', 'intermezzo', 'xRayAttack',
  'capturingDefender', 'trappedPiece', 'hangingPiece', 'sacrifice', 'quietMove',
  'zugzwang', 'underPromotion', 'promotion', 'enPassant', 'castling',
  'advancedPawn', 'attackingF2F7', 'kingsideAttack', 'queensideAttack', 'exposedKing'
]

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

/**
 * Describe a puzzle without giving away the move.
 *
 * Highlighting a square tells you *where* to look but not *why*, which is the
 * least instructive kind of help. Lichess tags every puzzle with its goal and
 * its tactical motif, so those tags can be turned into the sort of nudge a
 * coach would actually give: what the position is asking for, and which idea
 * delivers it.
 *
 * `moveCount` is the full solution length including the opponent's replies;
 * only your own moves are reported, since that is what you have to find.
 */
export function puzzleBrief(themes: string[], moveCount: number): PuzzleBrief {
  const has = (t: string): boolean => themes.includes(t)

  const mate = MATE_IN.find((m) => has(m.theme))
  const goal = mate?.text ?? GOALS.find((g) => has(g.theme))?.text ?? 'Find the strongest continuation.'

  // mateIn5 is open-ended ("five or more"), so a move count still helps there.
  const goalStatesLength = mate != null && mate.theme !== 'mateIn5'

  const motifId = MOTIF_ORDER.find((t) => has(t))
  const motif = motifId
    ? `${themeMeta(motifId).name} — ${lowerFirst(themeMeta(motifId).description)}`
    : fallbackAdvice(themes)

  // moveCount counts every half-move including the opening blunder, so the
  // player's share is what remains, rounded up.
  const yours = Math.max(1, Math.ceil(Math.max(0, moveCount - 1) / 2))
  const length = goalStatesLength
    ? ''
    : yours === 1
      ? 'It takes a single move.'
      : `You need to find ${NUMBER_WORDS[yours] ?? yours} moves.`

  return { goal, motif, length }
}

/**
 * Advice for puzzles the tags do not describe — most often forced mates, which
 * carry a mate tag and nothing else. Method beats a shrug.
 */
function fallbackAdvice(themes: string[]): string {
  const has = (t: string): boolean => themes.includes(t)

  if (has('mate') || themes.some((t) => t.startsWith('mateIn'))) {
    return "Start with checks. Every move in a forced mate is forcing, so work through them before anything quiet, and count the king's escape squares."
  }
  if (has('equality') || has('defensiveMove')) {
    return 'You are defending. Find their threat first, then the one move that answers it.'
  }
  if (has('endgame') || has('pawnEndgame') || has('rookEndgame')) {
    return 'An endgame: king activity and passed pawns decide these. Calculate to the end rather than by feel.'
  }
  return 'Work through the forcing moves first — checks, then captures, then threats.'
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}
