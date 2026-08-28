import type { PuzzleQuery } from '@shared/types'

/**
 * The training curriculum: a beginner-to-expert path through the ideas that
 * actually move a rating.
 *
 * Three kinds of lesson do the work:
 *
 * - `concept` walks through annotated positions, one idea per step.
 * - `drill`   hands you a position and makes you convert it against the engine.
 * - `practice` pulls unlimited fresh positions from the puzzle database, so the
 *   material never runs out and always matches the motif just taught.
 *
 * Keeping practice as a *query* rather than a fixed list is what lets ten lines
 * of definition back thousands of exercises.
 */

export interface ConceptStep {
  /** Position to display for this step. */
  fen: string
  /** What the learner should take away here. */
  text: string
  /** Optional move to play through, in UCI, illustrating the point. */
  playMove?: string
  /** Squares worth drawing attention to. */
  highlight?: string[]
}

export interface ConceptLesson {
  kind: 'concept'
  steps: ConceptStep[]
}

export interface DrillPosition {
  fen: string
  /** What counts as success. */
  goal: 'checkmate' | 'win' | 'draw' | 'promote'
  /** Shown before the drill starts. */
  brief: string
  /** Engine strength to defend with, in Elo. */
  defenderElo: number
  /** Fail the drill if it takes longer than this many moves. */
  moveLimit?: number
}

export interface DrillLesson {
  kind: 'drill'
  positions: DrillPosition[]
}

export interface PracticeLesson {
  kind: 'practice'
  /** Which puzzles to draw from. Rating band is applied on top of this. */
  query: Omit<PuzzleQuery, 'limit' | 'seed'>
  /** How many to solve to complete the lesson. */
  count: number
}

export type LessonBody = ConceptLesson | DrillLesson | PracticeLesson

export interface Lesson {
  id: string
  title: string
  /** One sentence on what this teaches. */
  summary: string
  /** Rough rating at which this material becomes relevant. */
  level: number
  body: LessonBody
}

export interface Module {
  id: string
  title: string
  blurb: string
  /** Rating band the module is aimed at, used for the "start here" hint. */
  band: [number, number]
  lessons: Lesson[]
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export const CURRICULUM: Module[] = [
  // =========================================================== module 1 ===
  {
    id: 'first-steps',
    title: 'First Steps',
    blurb: 'The board, the pieces, and the three ways a game can end.',
    band: [0, 800],
    lessons: [
      {
        id: 'board-and-pieces',
        title: 'The board and the pieces',
        summary: 'How each piece moves, and what it is worth.',
        level: 100,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: START,
              text: 'This is the starting position. White moves first. Notice the queens: each starts on her own colour — the white queen on a light square, the black queen on a dark one.',
              highlight: ['d1', 'd8']
            },
            {
              fen: '8/8/8/3R4/8/8/8/8 w - - 0 1',
              text: 'The rook moves any distance along ranks and files. It is worth about five pawns, and it grows stronger as the board empties.',
              highlight: ['d5']
            },
            {
              fen: '8/8/8/3B4/8/8/8/8 w - - 0 1',
              text: 'The bishop moves any distance diagonally. It is worth about three pawns and is stuck on one colour forever — which is why the pair of bishops is worth more than the sum of its parts.'
            },
            {
              fen: '8/8/8/3N4/8/8/8/8 w - - 0 1',
              text: 'The knight jumps in an L: two squares one way, one square the other. It is the only piece that can leap over others, and the only one that can attack a queen without being attacked back.'
            },
            {
              fen: '8/8/8/3Q4/8/8/8/8 w - - 0 1',
              text: 'The queen combines rook and bishop. Worth about nine pawns — but bringing her out too early just gives the opponent free moves attacking her.'
            },
            {
              fen: '8/8/8/3K4/8/8/8/8 w - - 0 1',
              text: 'The king moves one square in any direction. It has no material value because the game ends without it — but in the endgame it becomes a genuinely strong attacking piece.'
            },
            {
              fen: '8/8/8/8/8/8/3P4/8 w - - 0 1',
              text: 'Pawns move forward one square, or two from their starting square, but capture diagonally. They can never move backwards, so every pawn move is a permanent decision.'
            }
          ]
        }
      },
      {
        id: 'check-mate-stalemate',
        title: 'Check, checkmate, and stalemate',
        summary: 'The difference between winning and throwing away the win.',
        level: 150,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '4k3/8/8/8/8/8/8/4KR2 w - - 0 1',
              text: 'The rook attacks the king along the e-file after Rf1-e1. That is check: the king is under attack and the opponent must deal with it immediately.',
              playMove: 'f1e1'
            },
            {
              fen: '4k3/4R3/4K3/8/8/8/8/8 b - - 0 1',
              text: 'This is checkmate. The black king is in check from the rook, cannot capture it (the white king defends it), and every escape square is covered. The game is over.'
            },
            {
              fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
              text: 'This is stalemate, and it is a draw. Black is NOT in check, but has no legal move at all. Winning a piece and then stalemating is the most painful way to lose half a point — when your opponent is nearly out of moves, give them one.'
            }
          ]
        }
      },
      {
        id: 'special-moves',
        title: 'Castling, en passant, and promotion',
        summary: 'The three rules that surprise beginners.',
        level: 200,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
              text: 'Castling moves the king two squares toward a rook, and the rook hops to the far side. It gets your king safe and your rook into the game in a single move.',
              playMove: 'e1g1'
            },
            {
              fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
              text: 'You may not castle out of check, through an attacked square, or if the king or that rook has already moved. Castling queenside (O-O-O) is legal even if the b1 square is attacked.'
            },
            {
              fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
              text: 'Black has just played d7-d5, sliding past the white pawn. En passant lets White capture it as if it had only moved one square: exd6. This is only legal on the very next move.',
              playMove: 'e5d6'
            },
            {
              fen: '8/4P3/8/8/8/8/8/4k1K1 w - - 0 1',
              text: 'A pawn reaching the last rank becomes any piece you choose — almost always a queen. Occasionally a knight is better, and very occasionally a rook avoids stalemate.',
              playMove: 'e7e8q'
            }
          ]
        }
      },
      {
        id: 'first-tactics',
        title: 'Your first tactics',
        summary: 'Spotting free material — the single biggest source of rating points early on.',
        level: 400,
        body: {
          kind: 'practice',
          query: { themes: ['hangingPiece', 'mateIn1'], maxRating: 900 },
          count: 10
        }
      }
    ]
  },

  // =========================================================== module 2 ===
  {
    id: 'basic-mates',
    title: 'Basic Checkmates',
    blurb: 'Converting a winning material advantage into an actual win.',
    band: [400, 1000],
    lessons: [
      {
        id: 'ladder-mate',
        title: 'Two rooks: the ladder',
        summary: 'The simplest forced mate, and the pattern behind most others.',
        level: 400,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '4k3/8/8/8/8/8/R7/1R6 w - - 0 1',
              text: 'Two rooks mate by cutting the king off rank by rank. Ra2-a7 takes away the seventh rank; the king must retreat.',
              playMove: 'a2a7'
            },
            {
              fen: '4k3/R7/8/8/8/8/8/1R6 w - - 0 1',
              text: 'Now Rb1-b8 delivers mate: the king is confined to the eighth rank by one rook and checked along it by the other. Roll the ladder up the board and it works from any position.'
            }
          ]
        }
      },
      {
        id: 'queen-mate-drill',
        title: 'King and queen versus king',
        summary: 'Drive the king to the edge without stalemating it.',
        level: 500,
        body: {
          kind: 'drill',
          positions: [
            {
              fen: '8/8/4k3/8/8/8/3QK3/8 w - - 0 1',
              goal: 'checkmate',
              brief:
                'Use the queen a knight-move away from the enemy king to shrink its box, then bring your own king up to deliver mate. Watch for stalemate.',
              defenderElo: 2000,
              moveLimit: 20
            }
          ]
        }
      },
      {
        id: 'rook-mate-drill',
        title: 'King and rook versus king',
        summary: 'The same idea, but the rook needs the king’s help.',
        level: 600,
        body: {
          kind: 'drill',
          positions: [
            {
              fen: '8/8/4k3/8/8/8/4K3/7R w - - 0 1',
              goal: 'checkmate',
              brief:
                'Cut the king off with the rook, march your king up to take the opposition, then squeeze. This one rewards patience over checks.',
              defenderElo: 2000,
              moveLimit: 30
            }
          ]
        }
      },
      {
        id: 'back-rank-practice',
        title: 'Back-rank mates',
        summary: 'The most common mate in real games.',
        level: 700,
        body: {
          kind: 'practice',
          query: { themes: ['backRankMate'], maxRating: 1400 },
          count: 10
        }
      }
    ]
  },

  // =========================================================== module 3 ===
  {
    id: 'tactics-core',
    title: 'Tactics I — Core Motifs',
    blurb: 'Forks, pins, skewers, and discovered attacks. Most games below 1500 are decided here.',
    band: [600, 1400],
    lessons: [
      {
        id: 'fork-concept',
        title: 'The fork',
        summary: 'One piece, two targets, one of them has to fall.',
        level: 600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '4k3/8/8/8/4N3/8/8/4K2r w - - 0 1',
              text: 'Knight forks are the ones people miss, because the knight attacks squares no other piece can reach. From e4 the knight can leap to d6 or f6 — look for squares that hit two pieces at once.'
            },
            {
              fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
              text: 'Here Nd5-c7 forks the king and the rook. Because it comes with check, Black has no time to save the rook.',
              playMove: 'd5c7'
            }
          ]
        }
      },
      {
        id: 'fork-practice',
        title: 'Fork practice',
        summary: 'Fresh forks, drawn from the full puzzle database.',
        level: 800,
        body: { kind: 'practice', query: { themes: ['fork'] }, count: 12 }
      },
      {
        id: 'pin-skewer',
        title: 'Pins and skewers',
        summary: 'Two sides of the same idea: value in front, or value behind.',
        level: 800,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '4k3/8/8/8/8/2n5/8/B3K3 w - - 0 1',
              text: 'A pin freezes a piece: the knight on c3 cannot move because the king sits behind it. A piece pinned against the king is absolutely pinned — it may not legally move at all.',
              highlight: ['c3', 'e1']
            },
            {
              fen: '4k3/8/8/8/8/8/1q6/B3K3 w - - 0 1',
              text: 'A skewer is a pin in reverse: the valuable piece is in front. Bishop checks along the diagonal, the king steps aside, and the queen behind it drops.'
            }
          ]
        }
      },
      {
        id: 'pin-practice',
        title: 'Pin and skewer practice',
        summary: 'Recognise them under time pressure.',
        level: 1000,
        body: { kind: 'practice', query: { themes: ['pin', 'skewer'] }, count: 12 }
      },
      {
        id: 'discovered-practice',
        title: 'Discovered attacks',
        summary: 'The most violent motif in chess: two threats from one move.',
        level: 1100,
        body: { kind: 'practice', query: { themes: ['discoveredAttack', 'doubleCheck'] }, count: 10 }
      }
    ]
  },

  // =========================================================== module 4 ===
  {
    id: 'opening-principles',
    title: 'Opening Principles',
    blurb: 'Three rules that replace memorising a hundred variations.',
    band: [600, 1600],
    lessons: [
      {
        id: 'three-rules',
        title: 'Centre, develop, castle',
        summary: 'What to actually do in the first ten moves.',
        level: 600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: START,
              text: 'Rule one: fight for the centre. A pawn on e4 or d4 controls squares the enemy pieces want, and opens lines for your bishop and queen.',
              playMove: 'e2e4',
              highlight: ['d4', 'e4', 'd5', 'e5']
            },
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              text: 'Rule two: develop knights and bishops toward the centre, one move each. Do not move the same piece twice in the opening without a reason, and do not bring the queen out early.',
              playMove: 'g1f3'
            },
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
              text: 'Rule three: castle early. An uncastled king in an open position is the single most common cause of a lost game. Get it done by move ten.'
            },
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
              text: 'This is the Italian Game, and it follows all three rules. Both sides have a centre pawn, two developed pieces, and are ready to castle. You do not need theory to reach a good position.'
            }
          ]
        }
      },
      {
        id: 'opening-traps',
        title: 'Early traps and how not to fall for them',
        summary: 'Scholar’s mate, the f7 square, and premature queen raids.',
        level: 700,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3',
              text: 'White eyes f7 — the only square defended solely by the black king. Qd1-h5 threatens mate on f7 in one.',
              playMove: 'd1h5'
            },
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3',
              text: 'The answer is g7-g6, hitting the queen and defending. Do not panic and play the losing Ng8-f6. After g6 White has to retreat, and those wasted queen moves become your advantage.',
              playMove: 'g7g6'
            }
          ]
        }
      },
      {
        id: 'opening-practice',
        title: 'Opening tactics',
        summary: 'Punish the mistakes people actually make in the first fifteen moves.',
        level: 1000,
        body: { kind: 'practice', query: { themes: ['opening'] }, count: 10 }
      }
    ]
  },

  // =========================================================== module 5 ===
  {
    id: 'tactics-advanced',
    title: 'Tactics II — Advanced Motifs',
    blurb: 'Deflection, decoy, clearance, interference, and the quiet move.',
    band: [1300, 2000],
    lessons: [
      {
        id: 'deflection-concept',
        title: 'Deflection and attraction',
        summary: 'Move the defender, or drag the king somewhere fatal.',
        level: 1300,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
              text: 'Deflection asks: what is this piece doing, and can I make it stop? If a rook is the only thing guarding the back rank, attack it with something it must take.'
            },
            {
              fen: '5rk1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
              text: 'Attraction is the mirror image: instead of removing a defender, you lure a piece — usually the king — onto a square where a fork or mate is waiting. Both motifs start from the same question: which enemy piece is overworked?'
            }
          ]
        }
      },
      {
        id: 'deflection-practice',
        title: 'Deflection practice',
        summary: 'Overworked defenders, found and exploited.',
        level: 1400,
        body: {
          kind: 'practice',
          query: { themes: ['deflection', 'attraction', 'capturingDefender'] },
          count: 12
        }
      },
      {
        id: 'quiet-move',
        title: 'The quiet move',
        summary: 'The hardest tactic to see, because it is not a check or a capture.',
        level: 1700,
        body: {
          kind: 'practice',
          query: { themes: ['quietMove'], minRating: 1500 },
          count: 10
        }
      },
      {
        id: 'sacrifice-practice',
        title: 'Sacrifices',
        summary: 'Giving up material when the follow-up is forced.',
        level: 1700,
        body: { kind: 'practice', query: { themes: ['sacrifice'], minRating: 1500 }, count: 12 }
      },
      {
        id: 'defensive-practice',
        title: 'Defensive resources',
        summary: 'Finding the only move that saves a lost-looking position.',
        level: 1800,
        body: { kind: 'practice', query: { themes: ['defensiveMove'], minRating: 1500 }, count: 10 }
      }
    ]
  },

  // =========================================================== module 6 ===
  {
    id: 'pawn-endgames',
    title: 'Pawn Endgames',
    blurb: 'Pure calculation. Get these right and you will win games you used to draw.',
    band: [1000, 2000],
    lessons: [
      {
        id: 'opposition',
        title: 'The opposition',
        summary: 'The single most important idea in king-and-pawn endings.',
        level: 1000,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '8/8/4k3/8/4K3/8/8/8 b - - 0 1',
              text: 'The kings face each other with one square between them and it is Black to move. Whoever must move has to give ground — so here White holds the opposition and Black must step aside.',
              highlight: ['e4', 'e6']
            },
            {
              fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
              text: 'With a pawn, the opposition decides the game. The rule that matters: get your king in front of your pawn, not behind it. A king on the sixth rank ahead of its pawn wins regardless of the opposition.'
            },
            {
              fen: '8/8/4K3/4P3/4k3/8/8/8 w - - 0 1',
              text: 'White king on the sixth, pawn behind it: this wins for White whoever is to move. That is the pattern to memorise, because it turns a dozen calculations into one glance.'
            }
          ]
        }
      },
      {
        id: 'square-rule',
        title: 'The rule of the square',
        summary: 'Tell at a glance whether a king can catch a passed pawn.',
        level: 1100,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '7k/8/8/8/8/8/P7/K7 w - - 0 1',
              text: 'Draw a square whose side runs from the pawn to its promotion square. If the enemy king can step into that square on its move, it catches the pawn. If not, the pawn queens. No counting required.'
            }
          ]
        }
      },
      {
        id: 'pawn-endgame-drill',
        title: 'Converting a pawn up',
        summary: 'Play out a winning pawn ending against the engine.',
        level: 1300,
        body: {
          kind: 'drill',
          positions: [
            {
              fen: '8/8/8/3k4/8/3K4/3P4/8 w - - 0 1',
              goal: 'promote',
              brief:
                'You are a pawn up with the kings opposed. Remember: king in front of the pawn, and take the opposition before pushing.',
              defenderElo: 2200,
              moveLimit: 40
            }
          ]
        }
      },
      {
        id: 'pawn-endgame-practice',
        title: 'Pawn endgame puzzles',
        summary: 'Precise calculation with very little on the board.',
        level: 1400,
        body: { kind: 'practice', query: { themes: ['pawnEndgame'] }, count: 10 }
      }
    ]
  },

  // =========================================================== module 7 ===
  {
    id: 'rook-endgames',
    title: 'Rook Endgames',
    blurb: 'The most common endgame there is. Two positions cover most of it.',
    band: [1400, 2200],
    lessons: [
      {
        id: 'lucena',
        title: 'The Lucena position',
        summary: 'How to win with a rook and pawn against a rook.',
        level: 1600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
              text: 'This is the Lucena. Your pawn is one square from queening, your king is in front of it, and the enemy rook checks from the side. The winning method is called building a bridge.'
            },
            {
              fen: '1K1k4/1P6/8/8/8/8/r7/4R3 w - - 0 1',
              text: 'Put the rook on the fourth rank, step the king out, and when the checks come, interpose the rook. The bridge blocks the checking rook and the pawn promotes. This position is worth memorising exactly — it comes up constantly.'
            }
          ]
        }
      },
      {
        id: 'philidor',
        title: 'The Philidor position',
        summary: 'How to draw with a rook against a rook and pawn.',
        level: 1600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '8/8/8/8/4pk2/8/r7/4K2R w - - 0 1',
              text: 'The defensive counterpart. Hold your rook on the third rank to stop the enemy king advancing. The moment the pawn steps onto the third, drop your rook to the eighth and check from behind — the enemy king has nowhere to hide.'
            }
          ]
        }
      },
      {
        id: 'rook-activity',
        title: 'Active rooks beat passive ones',
        summary: 'Why a rook on the seventh is worth a pawn.',
        level: 1700,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '6k1/R4ppp/8/8/8/8/5PPP/6K1 w - - 0 1',
              text: 'A rook on the seventh rank attacks pawns on their starting squares and cuts the king off from the action. In rook endings, activity is usually worth more than a pawn — passive defence loses games that were objectively drawn.'
            }
          ]
        }
      },
      {
        id: 'rook-endgame-practice',
        title: 'Rook endgame puzzles',
        summary: 'The endings you will reach most often.',
        level: 1700,
        body: { kind: 'practice', query: { themes: ['rookEndgame'] }, count: 12 }
      }
    ]
  },

  // =========================================================== module 8 ===
  {
    id: 'positional',
    title: 'Positional Play',
    blurb: 'What to do when there is no tactic: structure, squares, and plans.',
    band: [1500, 2200],
    lessons: [
      {
        id: 'weak-squares',
        title: 'Weak squares and outposts',
        summary: 'A knight on a protected square in enemy territory is worth a rook.',
        level: 1500,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r1bq1rk1/pp2ppbp/2np1np1/2p5/2P5/2NPPN2/PP2BPPP/R1BQ1RK1 w - - 0 1',
              text: 'A weak square is one the opponent can no longer defend with a pawn. Find those squares, and put a knight there supported by a pawn — that is an outpost, and it will dominate the position for the rest of the game.',
              highlight: ['d5']
            }
          ]
        }
      },
      {
        id: 'pawn-structure',
        title: 'Pawn structure',
        summary: 'Doubled, isolated, backward, passed — and why each matters.',
        level: 1600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r1bqkb1r/pp3ppp/2n1pn2/3p4/3P4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 1',
              text: 'Pawns cannot move backwards, so pawn structure is the most permanent feature of a position. An isolated pawn is weak in the endgame but grants active pieces in the middlegame — the structure tells you which phase to steer toward.'
            },
            {
              fen: '8/pp3ppp/8/8/8/8/PPP2PPP/8 w - - 0 1',
              text: 'A pawn majority on one wing means a potential passed pawn. Count the pawns on each side of the board: whoever has the majority usually has the long-term winning plan there.'
            }
          ]
        }
      },
      {
        id: 'good-bad-bishop',
        title: 'Good and bad bishops',
        summary: 'Your bishop is only as good as the squares your pawns leave it.',
        level: 1600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: '4k3/3p1p2/4p3/8/8/4P3/3PBP2/4K3 w - - 0 1',
              text: 'A bishop hemmed in by its own pawns on the same colour is a bad bishop. Either trade it, or move the pawns off its colour. This one idea explains most closed-position plans.'
            }
          ]
        }
      },
      {
        id: 'positional-practice',
        title: 'Positional puzzles',
        summary: 'Quiet moves and long-term advantages.',
        level: 1800,
        body: {
          kind: 'practice',
          query: { themes: ['advantage', 'quietMove'], matchAll: true, minRating: 1700 },
          count: 10
        }
      }
    ]
  },

  // =========================================================== module 9 ===
  {
    id: 'attacking',
    title: 'Attacking the King',
    blurb: 'Opening lines, sacrificing on the right square, and finishing the job.',
    band: [1600, 2400],
    lessons: [
      {
        id: 'greek-gift',
        title: 'The Greek gift',
        summary: 'Bxh7+ — the most famous sacrifice in chess.',
        level: 1600,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r1bq1rk1/ppp2ppp/2n1pn2/3p4/1b1P4/2NBPN2/PPP2PPP/R1BQK2R w KQ - 0 1',
              text: 'The pattern needs three things: a bishop aiming at h7, a knight ready to jump to g5, and a queen that can reach h5. When all three are present, Bxh7+ Kxh7 Ng5+ leads to a winning attack.',
              highlight: ['d3', 'f3', 'd1']
            },
            {
              fen: 'r1bq1rk1/ppp2ppp/2n1pn2/3p4/1b1P4/2NBPN2/PPP2PPP/R1BQK2R w KQ - 0 1',
              text: 'Check the defenders before you commit. If Black can meet Ng5 with a defensive resource, or the king can run to g6, the sacrifice fails. The pattern gets you looking; calculation decides.'
            }
          ]
        }
      },
      {
        id: 'attack-practice',
        title: 'Kingside attacks',
        summary: 'Positions where the attack is already there to be found.',
        level: 1800,
        body: {
          kind: 'practice',
          query: { themes: ['kingsideAttack', 'exposedKing'], minRating: 1600 },
          count: 12
        }
      },
      {
        id: 'mating-nets',
        title: 'Mating patterns',
        summary: 'Smothered, Anastasia, Boden, Arabian — recognise them instantly.',
        level: 1900,
        body: {
          kind: 'practice',
          query: {
            themes: ['smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'hookMate', 'dovetailMate']
          },
          count: 12
        }
      }
    ]
  },

  // ========================================================== module 10 ===
  {
    id: 'expert',
    title: 'Expert Technique',
    blurb: 'Calculation, prophylaxis, and converting won positions cleanly.',
    band: [2000, 2600],
    lessons: [
      {
        id: 'calculation',
        title: 'Calculating properly',
        summary: 'Candidate moves, forcing first, and knowing when to stop.',
        level: 2000,
        body: {
          kind: 'concept',
          steps: [
            {
              fen: 'r4rk1/pp2qppp/2n1bn2/2bp4/8/1PN1PN2/PBQ1BPPP/R4RK1 w - - 0 1',
              text: 'List candidate moves before calculating any of them. Most blunders are not miscalculations — they are moves that were never considered at all.'
            },
            {
              fen: 'r4rk1/pp2qppp/2n1bn2/2bp4/8/1PN1PN2/PBQ1BPPP/R4RK1 w - - 0 1',
              text: 'Check forcing moves first, in this order: checks, captures, threats. They narrow the tree fastest, and if one of them wins outright you can stop looking.'
            },
            {
              fen: 'r4rk1/pp2qppp/2n1bn2/2bp4/8/1PN1PN2/PBQ1BPPP/R4RK1 w - - 0 1',
              text: 'At the end of every line, ask what your opponent wants to play next. Prophylaxis — stopping their idea before it starts — is what separates 2000 from 2300.'
            }
          ]
        }
      },
      {
        id: 'long-puzzles',
        title: 'Long combinations',
        summary: 'Four moves and deeper, calculated to the end.',
        level: 2100,
        body: { kind: 'practice', query: { themes: ['veryLong'], minRating: 2000 }, count: 10 }
      },
      {
        id: 'master-puzzles',
        title: 'Master-level positions',
        summary: 'The hardest material in the database.',
        level: 2300,
        body: { kind: 'practice', query: { minRating: 2400 }, count: 10 }
      },
      {
        id: 'endgame-conversion',
        title: 'Converting under pressure',
        summary: 'Win a technically won endgame against a stubborn engine.',
        level: 2200,
        body: {
          kind: 'drill',
          positions: [
            {
              fen: '8/5pk1/6p1/7p/7P/6P1/5PK1/3R4 w - - 0 1',
              goal: 'win',
              brief: 'Rook against pawns. Activate the rook, create a passed pawn, and do not let the king in.',
              defenderElo: 2400,
              moveLimit: 60
            },
            {
              fen: '8/8/4k3/8/8/8/4KB2/6N1 w - - 0 1',
              goal: 'checkmate',
              brief:
                'Bishop and knight mate — the hardest basic mate there is. Drive the king to a corner your bishop controls.',
              defenderElo: 2400,
              moveLimit: 60
            }
          ]
        }
      }
    ]
  }
]

export const ALL_LESSONS: Lesson[] = CURRICULUM.flatMap((m) => m.lessons)

export function findLesson(id: string): { module: Module; lesson: Lesson } | null {
  for (const module of CURRICULUM) {
    const lesson = module.lessons.find((l) => l.id === id)
    if (lesson) return { module, lesson }
  }
  return null
}

/** The module whose band best matches a player's current rating. */
export function suggestedModule(rating: number): Module {
  return (
    CURRICULUM.find((m) => rating >= m.band[0] && rating <= m.band[1]) ??
    (rating < 400 ? CURRICULUM[0] : CURRICULUM[CURRICULUM.length - 1])
  )
}

export function countLessons(): number {
  return ALL_LESSONS.length
}
