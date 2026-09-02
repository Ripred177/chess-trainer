"""Generate golden fixtures pinning the TypeScript core to the Python reference.

The app reimplements Maia-3's board tokenizer, move vocabulary and mirroring in
TypeScript so it can run under onnxruntime without a Python dependency. Those
are easy to get subtly wrong - a mirroring mistake produces legal but
nonsensical play rather than an obvious crash - so every piece of it is pinned
here against the upstream implementation.

Each case records, for one position:

  tokens      the flat indices set to 1 in the (64, 96) input tensor
  legal       the vocabulary indices the reference considers legal
  top         the reference model's ranked moves, in real board coordinates
  wdl         win/draw/loss probabilities for the side to move

Run after changing anything in `src/shared/maia/`:

    python scripts/maia/generate_fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import chess
import numpy as np
import torch

from maia3.dataset import tokenize_board
from maia3.model_registry import resolve_checkpoint_path, resolve_model_spec
from maia3.models import MAIA3Model
from maia3.utils import get_all_possible_moves, mirror_move

OUT = Path("src/shared/maia/__fixtures__/reference.json")
HISTORY = 8
TOP_K = 6

ALL_MOVES = get_all_possible_moves()
MOVE_TO_INDEX = {move: index for index, move in enumerate(ALL_MOVES)}


# Chosen to exercise the parts that are easy to get wrong rather than to be a
# representative sample of chess: both colours to move, promotions for each
# side, castling, en passant, and positions with real move history behind them.
CASES = [
    {
        "name": "starting position",
        "fen": chess.STARTING_FEN,
        "moves": [],
        "elo": 1500,
    },
    {
        "name": "black to move (mirroring)",
        "fen": chess.STARTING_FEN,
        "moves": ["e2e4"],
        "elo": 1500,
    },
    {
        "name": "italian, real history",
        "fen": chess.STARTING_FEN,
        "moves": ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"],
        "elo": 1100,
    },
    {
        "name": "history longer than the window",
        "fen": chess.STARTING_FEN,
        "moves": [
            "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6",
            "b5a4", "g8f6", "e1g1", "f8e7", "f1e1", "b7b5",
        ],
        "elo": 2000,
    },
    {
        "name": "white promotion available",
        "fen": "8/3P4/8/8/8/8/8/k6K w - - 0 1",
        "moves": [],
        "elo": 1500,
    },
    {
        "name": "black promotion available (mirrored)",
        "fen": "k6K/8/8/8/8/8/3p4/8 b - - 0 1",
        "moves": [],
        "elo": 1500,
    },
    {
        "name": "castling rights both sides",
        "fen": "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
        "moves": [],
        "elo": 1800,
    },
    {
        "name": "black castling",
        "fen": "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1",
        "moves": [],
        "elo": 1800,
    },
    {
        "name": "en passant available",
        "fen": "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
        "moves": [],
        "elo": 1500,
    },
    {
        "name": "endgame, low rating",
        "fen": "8/8/8/4k3/8/4K3/4P3/8 w - - 0 1",
        "moves": [],
        "elo": 600,
    },
    {
        "name": "endgame, high rating",
        "fen": "8/8/8/4k3/8/4K3/4P3/8 w - - 0 1",
        "moves": [],
        "elo": 2600,
    },
    {
        "name": "tactical middlegame",
        "fen": "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
        "moves": [],
        "elo": 2200,
    },
]


def load_reference():
    spec = resolve_model_spec("maia3-5m")
    cfg = SimpleNamespace(**spec.config)
    cfg.device = "cpu"
    model = MAIA3Model(cfg)
    blob = torch.load(resolve_checkpoint_path(spec), map_location="cpu", weights_only=True)
    state = blob["model_state_dict"] if isinstance(blob, dict) and "model_state_dict" in blob else blob
    state = {key.replace("smolgen", "gab"): value for key, value in state.items()}
    model.load_state_dict(state, strict=False)
    model.eval()
    return model, cfg


def board_after(fen: str, moves: list[str]) -> chess.Board:
    board = chess.Board(fen)
    for move in moves:
        board.push(chess.Move.from_uci(move))
    return board


def history_tokens(fen: str, moves: list[str], use_history: bool) -> torch.Tensor:
    """Reproduce the reference engine's two history modes.

    With `use_history`, every position from the start of the line is tokenized
    and the most recent `HISTORY` kept. Without it, only the current position is
    kept. Either way a short history is padded at the front by repeating its
    oldest entry, which is what makes inference possible early in a game.
    """
    board = chess.Board(fen)
    frames = [tokenize_board(board)]
    for move in moves:
        board.push(chess.Move.from_uci(move))
        frames.append(tokenize_board(board))

    frames = frames[-HISTORY:] if use_history else frames[-1:]

    tokens = torch.cat(frames, dim=1)
    if len(frames) < HISTORY:
        pad = frames[0].repeat(1, HISTORY - len(frames))
        tokens = torch.cat([pad, tokens], dim=1)
    return tokens


def legal_indices(board: chess.Board) -> list[int]:
    out = []
    for move in board.legal_moves:
        uci = move.uci() if board.turn == chess.WHITE else mirror_move(move.uci())
        index = MOVE_TO_INDEX.get(uci)
        if index is not None:
            out.append(index)
    return sorted(out)


def to_board_move(index: int, board: chess.Board) -> str:
    uci = ALL_MOVES[index]
    return uci if board.turn == chess.WHITE else mirror_move(uci)


def main() -> None:
    model, cfg = load_reference()
    assert cfg.history == HISTORY, f"model expects history={cfg.history}"

    cases = []
    for case in CASES:
        for use_history in (False, True):
            board = board_after(case["fen"], case["moves"])
            tokens = history_tokens(case["fen"], case["moves"], use_history)

            elo = torch.tensor([float(case["elo"])])
            with torch.no_grad():
                logits_move, logits_value, _ = model(tokens.unsqueeze(0), elo, elo)

            legal = legal_indices(board)
            masked = np.full(len(ALL_MOVES), -np.inf, dtype=np.float64)
            raw = logits_move[0].numpy().astype(np.float64)
            masked[legal] = raw[legal]

            shifted = masked - masked.max()
            exp = np.exp(shifted)
            probs = exp / exp.sum()

            ranked = np.argsort(-probs)[: min(TOP_K, len(legal))]
            value = torch.softmax(logits_value[0].float(), dim=-1).tolist()

            flat = tokens.reshape(-1).numpy()
            cases.append(
                {
                    "name": f"{case['name']} [{'history' if use_history else 'repeat'}]",
                    "fen": case["fen"],
                    "moves": case["moves"],
                    "elo": case["elo"],
                    "useHistory": use_history,
                    "positionFen": board.fen(),
                    "tokenIndices": np.flatnonzero(flat).tolist(),
                    "legalIndices": legal,
                    "top": [
                        {"uci": to_board_move(int(i), board), "policy": float(probs[i])}
                        for i in ranked
                    ],
                    # The reference orders value logits [loss, draw, win].
                    "wdl": {"win": value[2], "draw": value[1], "loss": value[0]},
                }
            )

    payload = {
        "model": "maia3-5m",
        "history": HISTORY,
        "vocabularySize": len(ALL_MOVES),
        "note": "Generated by scripts/maia/generate_fixtures.py. Do not edit by hand.",
        "cases": cases,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    size = OUT.stat().st_size / 1024
    print(f"wrote {OUT} ({len(cases)} cases, {size:.0f} KB)")


if __name__ == "__main__":
    main()
