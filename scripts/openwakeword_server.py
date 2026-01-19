#!/usr/bin/env python3
"""
OpenWakeWord detection server.
Reads 16-bit 16kHz PCM audio from stdin, outputs JSON detection events to stdout.

Protocol:
- Input: Raw 16-bit PCM audio frames (1280 samples = 80ms recommended)
- Output: JSON lines with detection events

Example output:
{"type": "detection", "model": "seraphina", "score": 0.92}
{"type": "ready", "models": ["seraphina", "luna"]}

Wakeword folder structure:
  wakewords/
    seraphina/
      model.onnx
      config.json  # {"wakewords": ["hey jarvis"], "threshold": 0.5}
    luna/
      model.onnx
      config.json
"""

import sys
import json
import argparse
import numpy as np
from pathlib import Path
from typing import Optional


def load_character_configs(wakewords_dir: Path) -> dict[str, dict]:
    """Load all character configs from wakewords directory."""
    configs = {}
    
    if not wakewords_dir.exists():
        return configs
    
    for char_dir in wakewords_dir.iterdir():
        if not char_dir.is_dir():
            continue
        
        config_path = char_dir / "config.json"
        if not config_path.exists():
            continue
        
        try:
            with open(config_path) as f:
                config = json.load(f)
            
            model_file = config.get("model", "model.onnx")
            model_path = char_dir / model_file
            
            if model_path.exists():
                configs[char_dir.name] = {
                    "model_path": str(model_path),
                    "threshold": config.get("threshold", 0.5),
                    "wakewords": config.get("wakewords", []),
                }
        except (json.JSONDecodeError, IOError) as e:
            emit({"type": "warning", "message": f"Failed to load config for {char_dir.name}: {e}"})
    
    return configs


def main():
    parser = argparse.ArgumentParser(description="OpenWakeWord detection server")
    parser.add_argument(
        "--wakewords-dir",
        type=Path,
        help="Path to wakewords directory containing character folders"
    )
    parser.add_argument(
        "--characters",
        nargs="*",
        help="Specific character names to load (default: all)"
    )
    parser.add_argument(
        "--models", 
        nargs="*", 
        help="Direct paths to .onnx or .tflite model files (legacy mode)"
    )
    parser.add_argument(
        "--threshold", 
        type=float,
        default=0.5,
        help="Default detection threshold (0.0-1.0), can be overridden per-character"
    )
    parser.add_argument(
        "--frame-size",
        type=int,
        default=1280,
        help="Audio frame size in samples (default: 1280 = 80ms at 16kHz)"
    )
    parser.add_argument(
        "--vad-threshold",
        type=float,
        default=0.0,
        help="VAD threshold (0 to disable)"
    )
    parser.add_argument(
        "--noise-suppression",
        action="store_true",
        help="Enable Speex noise suppression"
    )
    args = parser.parse_args()

    try:
        from openwakeword.model import Model
    except ImportError:
        emit({"type": "error", "message": "openwakeword not installed. Run: uv add openwakeword"})
        sys.exit(1)

    model_paths: list[str] = []
    model_name_to_character: dict[str, str] = {}
    character_thresholds: dict[str, float] = {}
    
    if args.wakewords_dir:
        configs = load_character_configs(args.wakewords_dir)
        
        if args.characters:
            configs = {k: v for k, v in configs.items() if k in args.characters}
        
        for char_name, config in configs.items():
            model_paths.append(config["model_path"])
            character_thresholds[char_name] = config["threshold"]
            
            model_file = Path(config["model_path"]).stem
            model_name_to_character[model_file] = char_name
    elif args.models:
        model_paths = args.models
    
    try:
        vad_threshold = args.vad_threshold if args.vad_threshold and args.vad_threshold > 0 else 0
            
        model = Model(
            wakeword_model_paths=model_paths,
            enable_speex_noise_suppression=args.noise_suppression,
            vad_threshold=vad_threshold,
        )
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load models: {e}"})
        sys.exit(1)

    loaded_models = list(model.models.keys())
    character_names = [model_name_to_character.get(m, m) for m in loaded_models]
    emit({"type": "ready", "models": character_names})

    frame_bytes = args.frame_size * 2
    
    while True:
        try:
            data = sys.stdin.buffer.read(frame_bytes)
            if not data:
                break
            
            if len(data) < frame_bytes:
                data = data + b'\x00' * (frame_bytes - len(data))
            
            audio_frame = np.frombuffer(data, dtype=np.int16)
            
            predictions = model.predict(audio_frame)
            
            for model_name, score in predictions.items():
                character_name = model_name_to_character.get(model_name, model_name)
                threshold = character_thresholds.get(character_name, args.threshold)
                
                if score >= threshold:
                    emit({
                        "type": "detection",
                        "model": character_name,
                        "score": float(score)
                    })
                    
        except KeyboardInterrupt:
            break
        except Exception as e:
            emit({"type": "error", "message": str(e)})


def emit(data: dict):
    """Write JSON line to stdout and flush."""
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
