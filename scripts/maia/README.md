# Maia-3 ONNX export

The app runs Maia-3 through onnxruntime, not through the upstream Python
engine, so the PyTorch checkpoint has to be converted once and the result
committed to the release assets.

This directory is **build tooling only**. Nothing here ships to users and
nothing in `src/` imports it — running the app does not require Python.

## Usage

```bash
python -m venv .venv && .venv/bin/pip install -r scripts/maia/requirements.txt
python scripts/maia/export_maia_onnx.py --model maia3-5m --out resources/engine/maia
```

That writes two files:

| file                | size   | used by                                  |
| ------------------- | ------ | ---------------------------------------- |
| `maia3-5m.onnx`     | ~21 MB | desktop (`onnxruntime-node`)             |
| `maia3-5m.int8.onnx`| ~7 MB  | web/PWA (`onnxruntime-web`), precached    |

Both are verified against the PyTorch reference before being written; the
script exits non-zero if parity fails, so a bad export cannot land silently.

## Why the model is patched during export

`torch.nn.RMSNorm` exports as `aten::rms_norm`, which needs opset 23 and is
poorly supported by onnxruntime-web. The script swaps each RMSNorm for an
arithmetically identical decomposition into primitive ops, keeping the graph
at opset 17 where every runtime we target has full coverage.

## Quantization

int8 dynamic quantization is applied to the web model only. Measured over 200
positions spanning 600-2600 Elo it agrees with fp32 on 98.5% of top-1 moves,
and every disagreement stays within fp32's top three candidates - comfortably
inside the model's own sampling noise, and worth it for a 3x smaller download.

## Licensing

Maia-3 is AGPL-3.0 (CSSLab, University of Toronto). The exported weights carry
that licence; see NOTICE.
