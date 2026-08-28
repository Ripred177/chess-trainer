/**
 * The theoretical endgame library.
 *
 * These are the positions whose *evaluation is already known* — you either know
 * the technique or you do not, and no amount of calculation at the board
 * reliably substitutes. That makes them worth drilling rather than solving:
 * each one is played out against the engine until the result is the
 * theoretical one.
 *
 * Selection follows the standard teaching order (Dvoretsky, Silman, de la
 * Villa all cover much the same ground in much the same sequence): basic mates
 * first, then king and pawn, then rook endings — which decide roughly half of
 * all games that reach an endgame — then minor pieces and queens.
 *
 * `goal` is the theoretical result for the side to move. A drill is passed by
 * achieving it, not by winning: holding a draw in a dead-drawn rook ending is
 * the skill being tested.
 *
 * Positions are standard textbook material, identified by name where one
 * exists. FENs are stated in full so nothing depends on a lookup at runtime.
 */

export type EndgameGoal = 'win' | 'draw'

export interface EndgamePosition {
  id: string
  name: string
  /** One line on what the position is and why it matters. */
  idea: string
  fen: string
  goal: EndgameGoal
  /**
   * The technique, in the order it has to be executed. Shown after the first
   * failure rather than up front, so the drill tests recall first.
   */
  method: string[]
  /** Engine strength for the defender. Theory holds against any strength. */
  defenderElo: number
  /** Abandon and fail the drill after this many of the player's moves. */
  moveLimit: number
}

export interface EndgameChapter {
  id: string
  title: string
  blurb: string
  /** Roughly the rating at which this chapter starts paying off. */
  fromRating: number
  positions: EndgamePosition[]
}

export const ENDGAME_CHAPTERS: EndgameChapter[] = [
  {
    id: 'basic-mates',
    title: 'Basic mates',
    blurb:
      'Forcing mate with limited material. Every one of these appears in real games, and the 50-move rule punishes not knowing them.',
    fromRating: 0,
    positions: [
      {
        id: 'mate-kq',
        name: 'King and queen',
        idea: 'Shrink the box with the queen, then bring the king. Beware stalemate the moment the enemy king reaches the edge.',
        fen: '8/8/8/4k3/8/8/2Q5/4K3 w - - 0 1',
        goal: 'win',
        method: [
          'Use the queen a knight’s move from the enemy king to steal squares.',
          'Drive the king to the edge — never stalemate it in the centre of a rank.',
          'Walk your own king up; only then deliver mate.'
        ],
        defenderElo: 1600,
        moveLimit: 20
      },
      {
        id: 'mate-kr',
        name: 'King and rook',
        idea: 'The rook cuts the king off; the two kings take the opposition. This is the building block for every rook ending.',
        fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
        goal: 'win',
        method: [
          'Cut the enemy king off along a rank or file with the rook.',
          'March your king up to take the opposition.',
          'Squeeze the box one rank at a time, checking only to gain a tempo.'
        ],
        defenderElo: 1600,
        moveLimit: 30
      },
      {
        id: 'mate-two-bishops',
        name: 'Two bishops',
        idea: 'The bishops build a wall; the king herds. Mate happens in a corner, and it takes real technique.',
        fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
        goal: 'win',
        method: [
          'Place the bishops on adjacent diagonals to form a barrier.',
          'Use the king to push the enemy king toward any corner.',
          'Do not let the barrier break while the king approaches.'
        ],
        defenderElo: 1600,
        moveLimit: 40
      }
    ]
  },

  {
    id: 'king-and-pawn',
    title: 'King and pawn',
    blurb:
      'The foundation. Every simplification decision in a game is really a question about whether the pawn ending is won.',
    fromRating: 800,
    positions: [
      {
        id: 'opposition-basic',
        name: 'The opposition',
        idea: 'With the kings facing each other an odd number of squares apart, whoever is NOT to move controls the position.',
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
        goal: 'win',
        method: [
          'Push the king ahead of the pawn, never the pawn ahead of the king.',
          'Take the opposition before advancing the pawn.',
          'The pawn moves only to gain a tempo you cannot gain with the king.'
        ],
        defenderElo: 1800,
        moveLimit: 30
      },
      {
        id: 'key-squares',
        name: 'Key squares',
        idea: 'Reaching the key squares in front of the pawn wins regardless of the opposition. Learn the squares and the counting disappears.',
        fen: '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1',
        goal: 'win',
        method: [
          'The key squares are two ranks ahead of the pawn (and the file either side).',
          'Head for them with the king; the pawn follows behind.',
          'On the sixth rank, occupying any key square wins on its own.'
        ],
        defenderElo: 1800,
        moveLimit: 32
      },
      {
        id: 'rook-pawn-draw',
        name: 'Rook pawn: the drawing corner',
        idea: 'A rook pawn is the great exception. If the defending king reaches the corner, no technique wins.',
        fen: '8/8/8/8/8/6k1/7P/6K1 b - - 0 1',
        goal: 'draw',
        method: [
          'Head for the corner square in front of the pawn — h8 here.',
          'Once the king sits there it cannot be evicted.',
          'Stalemate resources do the rest.'
        ],
        defenderElo: 2000,
        moveLimit: 24
      },
      {
        id: 'reti-idea',
        name: 'The Réti manoeuvre',
        idea: 'The most famous study idea in chess: a king chases two goals at once because diagonal paths cost no extra moves.',
        fen: '7K/8/k1P5/7p/8/8/8/8 w - - 0 1',
        goal: 'draw',
        method: [
          'Kg7 heads toward both the h-pawn and the c-pawn at once.',
          'The king travels diagonally, losing no tempo on either errand.',
          'Whichever the opponent stops, the other saves you.'
        ],
        defenderElo: 2000,
        moveLimit: 16
      }
    ]
  },

  {
    id: 'rook-endings',
    title: 'Rook endings',
    blurb:
      'The most common endgame by a wide margin. Two positions — Lucena and Philidor — decide the great majority of them.',
    fromRating: 1200,
    positions: [
      {
        id: 'lucena',
        name: 'The Lucena position',
        idea: 'The fundamental winning method with a rook and pawn: building a bridge so the king can escape the checks.',
        fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
        goal: 'win',
        method: [
          'Rook to the fourth rank — Rc4 — to prepare the shelter.',
          'Bring the king out: Kc7, and the enemy rook starts checking.',
          'March toward the rook until the bridge (Rc4–e4) blocks the last check.'
        ],
        defenderElo: 2000,
        moveLimit: 24
      },
      {
        id: 'philidor',
        name: 'The Philidor position',
        idea: 'The fundamental drawing method: hold the third rank until the pawn advances, then check from behind forever.',
        fen: '4k3/8/1r2K3/4P3/8/8/8/R7 b - - 0 1',
        goal: 'draw',
        method: [
          'Keep the rook on your third rank so the enemy king cannot advance.',
          'The moment the pawn steps to the sixth, drop the rook to the back rank.',
          'Check from behind; the king has no shelter from a distance.'
        ],
        defenderElo: 2000,
        moveLimit: 28
      },
      {
        id: 'rook-behind-passer',
        name: 'Rook behind the passed pawn',
        idea: 'Tarrasch’s rule. Behind its own passer the rook gains scope with every advance; in front of it the rook only grows more passive.',
        fen: '8/8/8/1P6/8/1k6/8/1R2K3 w - - 0 1',
        goal: 'win',
        method: [
          'Keep the rook behind the pawn so it gains squares as the pawn runs.',
          'Push only when the enemy king cannot blockade in time.',
          'Bring the king up to shoulder the defender aside.'
        ],
        defenderElo: 1900,
        moveLimit: 24
      },
      {
        id: 'vancura',
        name: 'The Vancura position',
        idea: 'The drawing method when your rook is stuck in front of an advanced rook pawn: attack it from the side instead.',
        fen: '8/8/P7/6k1/8/1r6/8/K5R1 b - - 0 1',
        goal: 'draw',
        method: [
          'Put the rook on the third rank, attacking the pawn from the side.',
          'Keep checking along the rank so the enemy king finds no shelter.',
          'The attacking rook can never free itself without losing the pawn.'
        ],
        defenderElo: 2000,
        moveLimit: 26
      },
      {
        id: 'short-side-defence',
        name: 'Short-side defence',
        idea: 'When the king cannot stay in front of the pawn, it goes to the short side so the rook gets checking distance on the long one.',
        fen: '2k5/R7/3K4/3P4/8/8/7r/8 b - - 0 1',
        goal: 'draw',
        method: [
          'Put the defending king on the short side of the pawn.',
          'Swing the rook to the long side for maximum checking distance.',
          'Check from three files away; the attacking king finds no shelter.'
        ],
        defenderElo: 2000,
        moveLimit: 28
      }
    ]
  },

  {
    id: 'minor-pieces',
    title: 'Minor pieces',
    blurb:
      'Where knowing one exception saves half a point: wrong bishops, fortress draws, and knowing which minor piece to keep.',
    fromRating: 1400,
    positions: [
      {
        id: 'wrong-bishop',
        name: 'The wrong bishop',
        idea: 'Rook pawn plus a bishop that does not control the queening square is a draw, however much material you are up.',
        fen: '7k/8/8/8/8/5B2/7P/6K1 b - - 0 1',
        goal: 'draw',
        method: [
          'The bishop is light-squared; the queening square h8 is dark.',
          'Sit the king on h8 and refuse to leave the corner.',
          'No arrangement of bishop and pawn can evict it.'
        ],
        defenderElo: 2000,
        moveLimit: 20
      },
      {
        id: 'knight-holds-one-wing',
        name: 'Knight holds a single wing',
        idea: 'The bishop is only the better piece when play spreads across both wings. With everything on one side the knight defends comfortably.',
        fen: '8/5pk1/4b1p1/7p/7P/5NP1/5PK1/8 w - - 0 1',
        goal: 'draw',
        method: [
          'Keep the pawn structure symmetrical and on one wing.',
          'The knight covers both colours of square, so no weakness is permanent.',
          'Refuse to create a second front and the draw holds itself.'
        ],
        defenderElo: 1900,
        moveLimit: 30
      }
    ]
  },

  {
    id: 'queen-endings',
    title: 'Queens and conversions',
    blurb:
      'Queen against a pawn is a race decided by a single trick — and the trick fails against two files.',
    fromRating: 1500,
    positions: [
      {
        id: 'queen-vs-pawn-centre',
        name: 'Queen against a pawn on the seventh',
        idea: 'Force the enemy king in front of its own pawn to gain a tempo, then walk your king closer. Repeat until it falls.',
        fen: '8/8/8/8/8/1k6/1p6/3K3Q w - - 0 1',
        goal: 'win',
        method: [
          'Check to drive the king in front of its own pawn, blocking it.',
          'That free tempo lets your king step one square nearer.',
          'Repeat until your king arrives; then the pawn drops.'
        ],
        defenderElo: 1900,
        moveLimit: 30
      },
      {
        id: 'queen-vs-bishop-pawn-draw',
        name: 'Queen against a bishop pawn',
        idea: 'The great exception: against a bishop or rook pawn the blocking trick backfires into stalemate, and the win vanishes.',
        fen: '7K/8/8/8/8/8/2p5/2k4Q w - - 0 1',
        goal: 'draw',
        method: [
          'Driving this king in front of the pawn produces stalemate, not a tempo.',
          'With the king too far away the position is a theoretical draw.',
          'Hold the draw rather than blundering into a loss.'
        ],
        defenderElo: 2000,
        moveLimit: 24
      }
    ]
  }
]

export const ALL_ENDGAMES: EndgamePosition[] = ENDGAME_CHAPTERS.flatMap((c) => c.positions)

export function endgameById(id: string): EndgamePosition | undefined {
  return ALL_ENDGAMES.find((p) => p.id === id)
}

export function chapterOf(positionId: string): EndgameChapter | undefined {
  return ENDGAME_CHAPTERS.find((c) => c.positions.some((p) => p.id === positionId))
}
