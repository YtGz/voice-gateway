# Wakeword Training

Windows-compatible Jupyter notebook for training custom [openWakeWord](https://github.com/dscripka/openwakeword) models.

## Quick Start

1. Setup the Jupyter kernel (one-time):
   ```bash
   uv add ipykernel --dev
   uv run python -m ipykernel install --user --name voice-gateway
   ```

2. Open `train_wakeword.ipynb` in VS Code

3. Select kernel: **voice-gateway**

4. Run all cells

## What Gets Downloaded

The notebook downloads several datasets (ignored by git):

| Dataset | Size | Purpose |
|---------|------|---------|
| Piper voice model | ~100MB | TTS for sample generation |
| OpenSLR RIR | ~300MB | Room impulse responses for reverb |
| MUSAN | ~11GB | Background noise/music |
| openWakeWord features | ~16GB | Negative training examples |

## Output

Trained models are saved to `my_custom_model/` and optionally copied to `../../wakewords/`.
