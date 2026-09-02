/**
 * Maia-3 inference, shared by the desktop and web builds.
 *
 * The model is a human-move predictor, not a search engine: it answers "what
 * would a player rated N play here", plus a win/draw/loss estimate. There is no
 * depth, no principal variation and no centipawn score behind any of it.
 *
 * Platform code supplies an onnxruntime session via `createOrtBackend` and
 * drives everything else through `MaiaSession`.
 */

export {
  HISTORY_PLIES,
  PLANES_PER_PLY,
  FEATURES_PER_SQUARE,
  TOKEN_LENGTH,
  encodePly,
  encodePositions,
  batchTokens
} from './encode'

export {
  PLAIN_MOVE_COUNT,
  PROMOTION_COUNT,
  VOCABULARY_SIZE,
  PROMOTION_PIECES,
  squareIndex,
  squareName,
  flipSquare,
  mirrorMove,
  moveToIndex,
  indexToMove,
  toModelFrame,
  fromModelFrame,
  type PromotionPiece
} from './vocabulary'

export { buildPosition, advance, type LegalMove, type MaiaPosition } from './position'

export {
  rankCandidates,
  sampleCandidate,
  wdlFromLogits,
  invertWdl,
  expectedScore,
  pseudoCentipawns,
  type Candidate,
  type SampleOptions,
  type Wdl
} from './policy'

export {
  MaiaSession,
  MAIA_MIN_ELO,
  MAIA_MAX_ELO,
  type MaiaBackend,
  type MaiaInput,
  type MaiaOutput,
  type EvaluateOptions,
  type Evaluation
} from './session'

export {
  createOrtBackend,
  type OrtSession,
  type OrtTensor,
  type OrtTensorFactory
} from './ort'

export {
  DEFAULT_EVALUATE_TOP,
  clampElo,
  strengthElo,
  temperatureFor,
  toEngineInfo,
  prepareSearch,
  runSearch,
  type PreparedSearch
} from './adapter'
