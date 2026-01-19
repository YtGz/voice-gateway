#!/usr/bin/env python3
"""
Test script for wakeword detection with live microphone input.

Usage:
  python scripts/test_wakeword.py --wakewords-dir wakewords
  python scripts/test_wakeword.py --wakewords-dir wakewords --characters seraphina
  python scripts/test_wakeword.py --model path/to/model.onnx  # legacy mode
"""

import sys
import json
import argparse
import subprocess
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Test wakeword detection with microphone")
    parser.add_argument("--wakewords-dir", type=Path, help="Path to wakewords directory")
    parser.add_argument("--characters", nargs="*", help="Specific characters to load")
    parser.add_argument("--model", help="Direct path to .onnx model file (legacy mode)")
    parser.add_argument("--threshold", type=float, default=0.5, help="Detection threshold")
    parser.add_argument("--list-devices", action="store_true", help="List audio input devices")
    parser.add_argument("--device", type=int, help="Audio input device index")
    args = parser.parse_args()

    try:
        import sounddevice as sd
    except ImportError:
        print("sounddevice not installed. Run: uv add sounddevice")
        sys.exit(1)

    if args.list_devices:
        print(sd.query_devices())
        return

    script_dir = Path(__file__).parent
    server_script = script_dir / "openwakeword_server.py"

    cmd = [sys.executable, str(server_script)]
    
    if args.wakewords_dir:
        cmd.extend(["--wakewords-dir", str(args.wakewords_dir)])
        if args.characters:
            cmd.extend(["--characters", *args.characters])
    elif args.model:
        cmd.extend(["--models", args.model])
    else:
        default_dir = script_dir.parent / "wakewords"
        if default_dir.exists():
            cmd.extend(["--wakewords-dir", str(default_dir)])
            print(f"Using default wakewords directory: {default_dir}")
        else:
            print("No wakewords directory specified. Using pre-trained models.")
    
    cmd.extend(["--threshold", str(args.threshold)])

    print(f"Starting wakeword server: {' '.join(cmd)}")
    
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0
    )

    import threading
    
    def read_stderr():
        for line in proc.stderr:
            sys.stderr.write(f"[stderr] {line.decode()}")
            sys.stderr.flush()
    
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()

    ready_line = proc.stdout.readline().decode().strip()
    print(f"Server output: {ready_line}")
    
    try:
        ready = json.loads(ready_line)
        if ready.get("type") == "error":
            print(f"Server error: {ready.get('message')}")
            sys.exit(1)
        models = ready.get('models', [])
        print(f"Characters loaded: {models}")
        if not models:
            print("Warning: No models loaded!")
    except json.JSONDecodeError:
        print(f"Unexpected output: {ready_line}")

    def read_detections():
        for line in proc.stdout:
            try:
                event = json.loads(line.decode().strip())
                if event.get("type") == "detection":
                    print(f"\n*** DETECTED: {event['model']} (score: {event['score']:.3f}) ***\n")
                elif event.get("type") == "error":
                    print(f"Error: {event['message']}")
                elif event.get("type") == "warning":
                    print(f"Warning: {event['message']}")
            except json.JSONDecodeError:
                pass

    detection_thread = threading.Thread(target=read_detections, daemon=True)
    detection_thread.start()

    frame_size = 1280
    sample_rate = 16000
    
    print(f"\nListening for wakeword... (Ctrl+C to stop)")
    print(f"Frame size: {frame_size} samples, Sample rate: {sample_rate} Hz")
    
    def audio_callback(indata, frames, time, status):
        if status:
            print(f"Audio status: {status}")
        try:
            proc.stdin.write(indata.tobytes())
            proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    try:
        with sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            dtype='int16',
            blocksize=frame_size,
            device=args.device,
            callback=audio_callback
        ):
            print("Audio stream started. Say your wakeword!")
            while proc.poll() is None:
                sd.sleep(100)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        proc.terminate()
        proc.wait()

if __name__ == "__main__":
    main()
