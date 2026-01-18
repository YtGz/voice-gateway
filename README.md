# Voice Gateway

A modular voice gateway that connects wake-word detection, speech-to-text, and text-to-speech with SillyTavern characters.

## Features

- **Wake-word detection** - Picovoice Porcupine or openWakeWord (free/open-source)
- **Streaming speech-to-text** using Picovoice Cheetah
- **Streaming text-to-speech** using Picovoice Orca
- **SillyTavern integration** via WebSocket
- **Character persistence** - remembers the last selected character (SQLite)
- **Modular architecture** - easily swap STT/TTS/wake-word providers

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Picovoice Account](https://console.picovoice.ai/) for access key (if using Porcupine/Cheetah/Orca)
- SillyTavern with WebSocket voice API running
- Python 3 (only if using openWakeWord)

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Copy the environment file and configure:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your settings:
   - `PICOVOICE_ACCESS_KEY` - Your Picovoice access key (required for Porcupine)
   - `SILLYTAVERN_WS_URL` - SillyTavern WebSocket URL (default: `ws://localhost:8000/ws/voice`)
   - `AUDIO_DEVICE_INDEX` - Microphone device index (-1 for auto-detect)
   - `WAKEWORD_ENGINE` - `porcupine` (default) or `openwakeword`
   - `WAKE_WORD_SENSITIVITY` - Detection sensitivity (0.0-1.0)

4. Set up wake words for your characters:

   **Option A: Picovoice Porcupine** (requires account)
   - Create wake words at [Picovoice Console](https://console.picovoice.ai/)
   - Download `.ppn` files and place in `wakewords/` directory
   - File names determine character mapping (e.g., `luna.ppn` → "Luna")
   
   **Option B: openWakeWord** (free, open-source)
   - Install Python dependencies: `pip install openwakeword`
   - Set `WAKEWORD_ENGINE=openwakeword` in `.env`
   - Use pre-trained models or train custom ones
   - Place `.onnx` or `.tflite` files in `wakewords/` directory

## Usage

List available audio devices:
```bash
bun run start -- --list-devices
```

Start the voice gateway:
```bash
bun run start
```

Development mode (auto-reload):
```bash
bun run dev
```

## Docker

Build and run with Docker Compose:

```bash
# Build the image
docker compose build

# List audio devices inside container
docker compose run --rm voice-gateway bun run start -- --list-devices

# Start the service
docker compose up -d
```

### Audio Setup (Linux)

The container needs access to your audio device. Two options:

**Option A: ALSA (default in docker-compose.yml)**
- Passes `/dev/snd` directly to the container
- Works with most USB audio devices

**Option B: PulseAudio**
- Uncomment the PulseAudio section in `docker-compose.yml`
- Adjust the UID (1000) to match your user

### Finding Your Audio Device

After connecting your USB speakerphone/microphone:

1. **Verify the device is recognized by the host:**
   ```bash
   # List USB devices
   lsusb
   
   # Example output - look for your device:
   # Bus 001 Device 004: ID 2c31:0003 Beyerdynamic SPACE MAX
   
   # List ALSA recording devices
   arecord -l
   
   # Example output:
   # card 2: MAX [SPACE MAX], device 0: USB Audio [USB Audio]
   #   Subdevices: 1/1
   #   Subdevice #0: subdevice #0
   ```

2. **Find the device index inside the container:**
   ```bash
   docker compose run --rm voice-gateway bun run start -- --list-devices
   
   # Example output:
   # Available audio devices:
   #   [0] default
   #   [1] sysdefault:CARD=MAX
   #   [2] front:CARD=MAX,DEV=0
   #   [3] ...
   ```
   
   Look for your device name (e.g., "MAX" or "SPACE MAX") and note the index number in brackets.

3. **Configure the device index in `.env`:**
   ```bash
   # Set the index from step 2
   AUDIO_DEVICE_INDEX=1
   ```

4. **Test audio capture:**
   ```bash
   # Record a short test (requires alsa-utils in container)
   docker compose run --rm voice-gateway arecord -d 3 -f cd test.wav
   
   # If you hear nothing or get errors, try a different device index
   ```

### Troubleshooting Audio

| Problem | Solution |
|---------|----------|
| No devices listed | Check USB connection, verify device appears in `lsusb` |
| Permission denied | Ensure `group_add: [audio]` is set, or add `privileged: true` |
| Wrong device selected | Run `--list-devices` and try different indices |
| Device busy | Stop other applications using the audio device |
| No sound on Arch Linux | Install `alsa-utils`: `sudo pacman -S alsa-utils` |

### Docker with SillyTavern

Example `docker-compose.yml` including SillyTavern:

```yaml
services:
  voice-gateway:
    build: .
    env_file:
      - .env
    environment:
      - SILLYTAVERN_WS_URL=ws://sillytavern:8000/ws/voice
      - DATA_DIR=/app/data
    volumes:
      - ./wakewords:/app/wakewords:ro
      - ./data:/app/data
    devices:
      - /dev/snd:/dev/snd
    group_add:
      - audio
    depends_on:
      - sillytavern

  sillytavern:
    image: ghcr.io/sillytavern/sillytavern:latest
    volumes:
      - ./st-config:/home/node/app/config
      - ./st-data:/home/node/app/data
```

## How It Works

1. **Waiting for wake word** - The system listens for character names
2. **Speech capture** - After detecting a wake word, it captures your spoken prompt
3. **Character routing** - Sends the prompt to the appropriate SillyTavern character
4. **Response generation** - Receives streamed response from the AI
5. **Speech synthesis** - Converts the response to audio and plays it

## Project Structure

```
src/
├── index.ts          # Main entry point & orchestrator
├── config.ts         # Configuration loading
├── types/            # TypeScript interfaces
├── wakeword/         # Wake word detection (Porcupine, openWakeWord)
├── stt/              # Speech-to-text (Cheetah)
├── tts/              # Text-to-speech (Orca)
├── vad/              # Voice activity detection (Cobra)
├── sillytavern/      # SillyTavern WebSocket client
├── audio/            # Audio input/output handling
└── db/               # SQLite persistence
scripts/
└── openwakeword_server.py  # Python subprocess for openWakeWord
```

## Wake Word Engines

### Picovoice Porcupine (Default)

- Requires Picovoice account and access key
- Custom wake words via Picovoice Console
- `.ppn` files are tied to your account (don't share publicly)
- Counts against monthly active user limits

### openWakeWord (Alternative)

- Free and open-source
- No account required
- Pre-trained models available (hey_jarvis, alexa, etc.)
- Custom model training supported
- Runs as Python subprocess

To use openWakeWord:

```bash
# Install Python dependencies
uv add openwakeword

# Configure in .env
WAKEWORD_ENGINE=openwakeword
```

## Docker with openWakeWord

Use the openWakeWord-enabled Dockerfile:

```bash
docker build -f Dockerfile.openwakeword -t voice-gateway:openwakeword .
```

Or update `docker-compose.yml`:

```yaml
services:
  voice-gateway:
    build:
      context: .
      dockerfile: Dockerfile.openwakeword
    # ... rest of config
```

## Extending

The modular architecture allows swapping components:

- **Wake word**: Implement `WakeWordDetector` interface
- **STT**: Implement `SpeechToText` interface
- **TTS**: Implement `TextToSpeech` interface
- **Audio I/O**: Implement `AudioInput`/`AudioOutput` interfaces

## License

MIT-0
