#!/usr/bin/env python3
"""
OpenWakeWord detection server.
Reads 16-bit 16kHz PCM audio from stdin, outputs JSON detection events to stdout.

Protocol:
- Input: Raw 16-bit PCM audio frames (1280 samples = 80ms recommended)
- Output: JSON lines with detection events

Example output:
{"type": "detection", "model": "hey_jarvis", "score": 0.92}
{"type": "ready", "models": ["hey_jarvis", "alexa"]}
"""

import sys
import json
import argparse
import numpy as np
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="OpenWakeWord detection server")
    parser.add_argument(
        "--models", 
        nargs="*", 
        help="Paths to .onnx or .tflite model files (empty for all pre-trained)"
    )
    parser.add_argument(
        "--threshold", 
        type=float, 
        default=0.5,
        help="Detection threshold (0.0-1.0)"
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
        emit({"type": "error", "message": "openwakeword not installed. Run: pip install openwakeword"})
        sys.exit(1)

    model_paths = args.models if args.models else None
    
    try:
        model = Model(
            wakeword_models=model_paths,
            enable_speex_noise_suppression=args.noise_suppression,
            vad_threshold=args.vad_threshold if args.vad_threshold > 0 else None,
        )
    except Exception as e:
        emit({"type": "error", "message": f"Failed to load models: {e}"})
        sys.exit(1)

    model_names = list(model.models.keys())
    emit({"type": "ready", "models": model_names})

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
                if score >= args.threshold:
                    emit({
                        "type": "detection",
                        "model": model_name,
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
