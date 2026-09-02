/**
 * Bridge from the platform-agnostic session to an onnxruntime InferenceSession.
 *
 * `onnxruntime-node` and `onnxruntime-web` expose the same `run` shape but are
 * different packages, and neither can be imported from shared code without
 * dragging the wrong one into the other build. So the session and its Tensor
 * constructor are passed in, and this file stays import-free.
 */

import { TOKEN_LENGTH } from './encode'
import type { MaiaBackend, MaiaInput, MaiaOutput } from './session'

/** The slice of onnxruntime's Tensor we depend on. */
export interface OrtTensor {
  data: Float32Array
}

export type OrtTensorFactory = (
  type: 'float32',
  data: Float32Array,
  dims: readonly number[]
) => OrtTensor

/** The slice of onnxruntime's InferenceSession we depend on. */
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
}

/** Input and output names as written by `scripts/maia/export_maia_onnx.py`. */
const INPUT_TOKENS = 'tokens'
const INPUT_SELF_ELO = 'self_elo'
const INPUT_OPPO_ELO = 'oppo_elo'
const OUTPUT_MOVE = 'logits_move'
const OUTPUT_VALUE = 'logits_value'

export function createOrtBackend(session: OrtSession, tensor: OrtTensorFactory): MaiaBackend {
  return {
    async run(input: MaiaInput): Promise<MaiaOutput> {
      if (input.tokens.length !== input.batch * TOKEN_LENGTH) {
        throw new Error(
          `expected ${input.batch * TOKEN_LENGTH} token features, got ${input.tokens.length}`
        )
      }

      const outputs = await session.run({
        [INPUT_TOKENS]: tensor('float32', input.tokens, [input.batch, 64, TOKEN_LENGTH / 64]),
        [INPUT_SELF_ELO]: tensor('float32', input.selfElo, [input.batch]),
        [INPUT_OPPO_ELO]: tensor('float32', input.oppoElo, [input.batch])
      })

      const move = outputs[OUTPUT_MOVE]
      const value = outputs[OUTPUT_VALUE]
      if (!move || !value) {
        throw new Error('model did not return the expected outputs')
      }

      return { move: move.data, value: value.data }
    }
  }
}
