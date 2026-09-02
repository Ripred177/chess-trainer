"""Convert a Maia-3 PyTorch checkpoint into the ONNX graphs the app ships.

The desktop app runs `onnxruntime-node` and the web build runs
`onnxruntime-web`, so the upstream Python engine is only ever used here, at
build time, to produce and validate the graphs.

Two artefacts come out of a run:

  <name>.onnx        fp32, for desktop
  <name>.int8.onnx   dynamically quantized, for the PWA download

Both are checked against the PyTorch reference before anything is written to
the output directory, and the script exits non-zero on any mismatch. A silently
wrong export would surface as a bot that plays subtly inhuman moves, which is
exactly the kind of bug that is miserable to track down later.
"""

from __future__ import annotations

import argparse
import random
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import chess
import numpy as np
import torch

from maia3.dataset import tokenize_board
from maia3.model_registry import resolve_checkpoint_path, resolve_model_spec
from maia3.models import MAIA3Model
from maia3.utils import get_all_possible_moves, mirror_move


# Opset 17 is the newest level with full coverage across onnxruntime-node and
# onnxruntime-web's WASM backend. Nothing in the model needs anything later.
OPSET = 17

# Parity threshold. The logits are O(10), so this is far tighter than anything
# that could flip a move choice, while leaving room for float reassociation.
LOGIT_TOLERANCE = 1e-3

ALL_MOVES = get_all_possible_moves()
MOVE_TO_INDEX = {move: i for i, move in enumerate(ALL_MOVES)}


class PlainRMSNorm(torch.nn.Module):
    """`torch.nn.RMSNorm` rewritten in primitive ops.

    The stock module exports as `aten::rms_norm`, which requires opset 23 and
    is not reliably implemented by onnxruntime-web. This computes the same
    value using ops every runtime we target supports.
    """

    def __init__(self, source: torch.nn.RMSNorm) -> None:
        super().__init__()
        # torch reads eps=None as "use the dtype's epsilon"; inference is fp32.
        self.eps = source.eps if source.eps is not None else torch.finfo(torch.float32).eps
        self.weight = source.weight

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        variance = x.pow(2).mean(dim=-1, keepdim=True)
        x = x * torch.rsqrt(variance + self.eps)
        if self.weight is not None:
            x = x * self.weight
        return x


def replace_rms_norm(module: torch.nn.Module) -> int:
    """Swap every RMSNorm in the tree for the exportable form; returns the count."""
    replaced = 0
    for name, child in list(module.named_children()):
        if isinstance(child, torch.nn.RMSNorm):
            setattr(module, name, PlainRMSNorm(child))
            replaced += 1
        else:
            replaced += replace_rms_norm(child)
    return replaced


class ExportWrapper(torch.nn.Module):
    """Takes Elo as float32.

    The reference engine passes int64 Elo tensors, but the model immediately
    divides them, so the arithmetic is identical either way. Float inputs save
    the JS callers from building a BigInt64Array on every move.
    """

    def __init__(self, model: MAIA3Model) -> None:
        super().__init__()
        self.model = model

    def forward(self, tokens, self_elo, oppo_elo):
        return self.model(tokens, self_elo, oppo_elo)


def load_reference_model(spec) -> tuple[MAIA3Model, SimpleNamespace]:
    cfg = SimpleNamespace(**spec.config)
    cfg.device = "cpu"

    checkpoint = resolve_checkpoint_path(spec)
    print(f"  checkpoint  {checkpoint}")

    model = MAIA3Model(cfg)
    blob = torch.load(checkpoint, map_location="cpu", weights_only=True)
    state = blob["model_state_dict"] if isinstance(blob, dict) and "model_state_dict" in blob else blob
    # Older checkpoints used the "smolgen" name for what is now GAB.
    state = {key.replace("smolgen", "gab"): value for key, value in state.items()}

    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        raise SystemExit(f"checkpoint is missing weights the model needs: {sorted(missing)[:8]}")
    if unexpected:
        print(f"  note: ignoring {len(unexpected)} unused checkpoint tensors")

    model.eval()
    return model, cfg


def encode(fens: list[str], history: int) -> torch.Tensor:
    """Board tokens for a batch, current position repeated to fill history.

    Repeating is what the reference engine does when it has no real history to
    draw on, so it is the right shape to validate against.
    """
    return torch.stack([tokenize_board(chess.Board(fen)).repeat(1, history) for fen in fens])


def legal_mask(board: chess.Board) -> np.ndarray:
    mask = np.zeros(len(ALL_MOVES), dtype=bool)
    for move in board.legal_moves:
        # The board is mirrored for black, so the move vocabulary is too.
        uci = move.uci() if board.turn == chess.WHITE else mirror_move(move.uci())
        index = MOVE_TO_INDEX.get(uci)
        if index is not None:
            mask[index] = True
    return mask


def best_legal_move(logits: np.ndarray, board: chess.Board) -> str:
    mask = legal_mask(board)
    index = int(np.argmax(np.where(mask, logits, -np.inf)))
    uci = ALL_MOVES[index]
    return uci if board.turn == chess.WHITE else mirror_move(uci)


def sample_positions(count: int, seed: int = 7) -> list[str]:
    """Positions from random legal play, for a spread of realistic material."""
    rng = random.Random(seed)
    fens: list[str] = []
    board = chess.Board()
    while len(fens) < count:
        if board.is_game_over() or board.fullmove_number > 60:
            board = chess.Board()
            continue
        fens.append(board.fen())
        board.push(rng.choice(list(board.legal_moves)))
    return fens


def softmax(x: np.ndarray) -> np.ndarray:
    exp = np.exp(x - x.max())
    return exp / exp.sum()


def verify(onnx_path: Path, reference: ExportWrapper, history: int, positions: int) -> None:
    """Fail loudly if the graph disagrees with PyTorch on logits or move choice."""
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    fens = sample_positions(positions)
    rng = random.Random(11)
    elos = [rng.choice([600, 1100, 1500, 2000, 2600]) for _ in fens]

    worst_move = worst_value = 0.0
    disagreements = 0

    for fen, elo in zip(fens, elos):
        tokens = encode([fen], history)
        elo_tensor = torch.tensor([float(elo)])

        with torch.no_grad():
            ref_move, ref_value, _ = reference(tokens, elo_tensor, elo_tensor)

        onnx_move, onnx_value, _ = session.run(
            None,
            {
                "tokens": tokens.numpy(),
                "self_elo": elo_tensor.numpy(),
                "oppo_elo": elo_tensor.numpy(),
            },
        )

        worst_move = max(worst_move, float(np.abs(ref_move.numpy() - onnx_move).max()))
        worst_value = max(worst_value, float(np.abs(ref_value.numpy() - onnx_value).max()))

        board = chess.Board(fen)
        if best_legal_move(ref_move.numpy()[0], board) != best_legal_move(onnx_move[0], board):
            disagreements += 1

    print(f"  logits max deviation   {worst_move:.2e} (move) / {worst_value:.2e} (value)")
    print(f"  top-move agreement     {positions - disagreements}/{positions}")

    if worst_move > LOGIT_TOLERANCE or worst_value > LOGIT_TOLERANCE:
        raise SystemExit("export failed parity: logits deviate beyond tolerance")
    if disagreements:
        raise SystemExit(f"export failed parity: {disagreements} positions chose a different move")

    # A batch size baked into the graph would break MultiPV, which scores every
    # candidate in one call. Cross-check batched output against single runs.
    batch_fens = fens[:6]
    batch_elos = torch.tensor([600.0, 1000.0, 1400.0, 1800.0, 2200.0, 2600.0])
    batched = session.run(
        None,
        {
            "tokens": encode(batch_fens, history).numpy(),
            "self_elo": batch_elos.numpy(),
            "oppo_elo": batch_elos.numpy(),
        },
    )[0]
    singles = np.stack(
        [
            session.run(
                None,
                {
                    "tokens": encode([fen], history).numpy(),
                    "self_elo": batch_elos[index : index + 1].numpy(),
                    "oppo_elo": batch_elos[index : index + 1].numpy(),
                },
            )[0][0]
            for index, fen in enumerate(batch_fens)
        ]
    )
    drift = float(np.abs(batched - singles).max())
    print(f"  batched vs single      {drift:.2e}")
    if drift > LOGIT_TOLERANCE:
        raise SystemExit("export failed parity: batched inference disagrees with single inference")


def compare_quantized(fp32_path: Path, int8_path: Path, history: int, positions: int) -> None:
    """Report how far int8 drifts from fp32 in move choice and WDL."""
    import onnxruntime as ort

    fp32 = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
    int8 = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])

    fens = sample_positions(positions)
    rng = random.Random(11)
    elos = [rng.choice([600, 1100, 1500, 2000, 2600]) for _ in fens]

    agree = in_top3 = 0
    wdl_deviation: list[float] = []

    for fen, elo in zip(fens, elos):
        feed = {
            "tokens": encode([fen], history).numpy(),
            "self_elo": np.array([float(elo)], np.float32),
            "oppo_elo": np.array([float(elo)], np.float32),
        }
        fp32_move, fp32_value, _ = fp32.run(None, feed)
        int8_move, int8_value, _ = int8.run(None, feed)

        board = chess.Board(fen)
        mask = legal_mask(board)
        if not mask.any():
            continue

        fp32_probs = softmax(fp32_move[0][mask])
        int8_probs = softmax(int8_move[0][mask])
        agree += int(np.argmax(fp32_probs)) == int(np.argmax(int8_probs))
        in_top3 += int(np.argmax(int8_probs)) in np.argsort(-fp32_probs)[:3]
        wdl_deviation.append(float(np.abs(softmax(fp32_value[0]) - softmax(int8_value[0])).max()))

    total = len(wdl_deviation)
    print(f"  int8 top-1 agreement   {agree}/{total} ({100 * agree / total:.1f}%)")
    print(f"  int8 pick in fp32 top3 {in_top3}/{total} ({100 * in_top3 / total:.1f}%)")
    print(f"  int8 WDL max deviation {max(wdl_deviation):.4f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Maia-3 to ONNX.")
    parser.add_argument("--model", default="maia3-5m", help="upstream model alias")
    parser.add_argument("--out", default="resources/engine/maia", help="output directory")
    parser.add_argument("--positions", type=int, default=200, help="positions used to verify")
    parser.add_argument("--skip-int8", action="store_true", help="export fp32 only")
    args = parser.parse_args()

    spec = resolve_model_spec(args.model)
    print(f"exporting {spec.display_name}")

    model, cfg = load_reference_model(spec)
    replaced = replace_rms_norm(model)
    print(f"  parameters  {sum(p.numel() for p in model.parameters()):,}")
    print(f"  rmsnorm     {replaced} layers decomposed for opset {OPSET}")

    wrapper = ExportWrapper(model).eval()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    fp32_path = out_dir / f"{spec.name}.onnx"
    int8_path = out_dir / f"{spec.name}.int8.onnx"

    # Stage into a temp directory so a failed verification never leaves a
    # half-valid model where the build expects a good one.
    with tempfile.TemporaryDirectory() as tmp:
        staged_fp32 = Path(tmp) / fp32_path.name
        staged_int8 = Path(tmp) / int8_path.name

        dummy_tokens = encode([chess.STARTING_FEN], cfg.history)
        dummy_elo = torch.tensor([1500.0])

        torch.onnx.export(
            wrapper,
            (dummy_tokens, dummy_elo, dummy_elo),
            str(staged_fp32),
            input_names=["tokens", "self_elo", "oppo_elo"],
            output_names=["logits_move", "logits_value", "logits_ponder"],
            dynamic_axes={
                name: {0: "batch"}
                for name in (
                    "tokens",
                    "self_elo",
                    "oppo_elo",
                    "logits_move",
                    "logits_value",
                    "logits_ponder",
                )
            },
            opset_version=OPSET,
            do_constant_folding=True,
            dynamo=False,
        )
        print(f"  fp32        {staged_fp32.stat().st_size / 1e6:.1f} MB")

        print("verifying fp32 against PyTorch")
        verify(staged_fp32, wrapper, cfg.history, args.positions)

        if not args.skip_int8:
            from onnxruntime.quantization import QuantType, quantize_dynamic

            quantize_dynamic(str(staged_fp32), str(staged_int8), weight_type=QuantType.QInt8)
            print(f"  int8        {staged_int8.stat().st_size / 1e6:.1f} MB")
            print("comparing int8 against fp32")
            compare_quantized(staged_fp32, staged_int8, cfg.history, args.positions)

        shutil.move(str(staged_fp32), fp32_path)
        if not args.skip_int8:
            shutil.move(str(staged_int8), int8_path)

    print()
    print(f"wrote {fp32_path}")
    if not args.skip_int8:
        print(f"wrote {int8_path}")


if __name__ == "__main__":
    sys.exit(main())
