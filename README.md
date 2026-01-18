# Voice Gateway

A modular voice gateway that connects wake-word detection, speech-to-text, and text-to-speech with SillyTavern characters.

## Features

- **Wake-word detection** using Picovoice Porcupine - each wake word routes to a specific character
- **Streaming speech-to-text** using Picovoice Cheetah
- **Streaming text-to-speech** using Picovoice Orca
- **SillyTavern integration** via WebSocket
- **Character persistence** - remembers the last selected character (SQLite)
- **Modular architecture** - easily swap STT/TTS/wake-word providers

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Picovoice Account](https://console.picovoice.ai/) for access key and custom wake words
- SillyTavern with WebSocket voice API running

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
   - `PICOVOICE_ACCESS_KEY` - Your Picovoice access key
   - `SILLYTAVERN_WS_URL` - SillyTavern WebSocket URL (default: `ws://localhost:8000/ws/voice`)
   - `AUDIO_DEVICE_INDEX` - Microphone device index
   - `WAKE_WORD_SENSITIVITY` - Detection sensitivity (0.0-1.0)

4. Create custom wake words for your characters at [Picovoice Console](https://console.picovoice.ai/):
   - Create a wake word for each character name (e.g., "Luna", "Alice")
   - Download the `.ppn` files
   - Place them in the `wakewords/` directory
   - File names determine character mapping (e.g., `luna.ppn` → "Luna")

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
├── wakeword/         # Wake word detection (Porcupine)
├── stt/              # Speech-to-text (Cheetah)
├── tts/              # Text-to-speech (Orca)
├── sillytavern/      # SillyTavern WebSocket client
├── audio/            # Audio input/output handling
└── db/               # SQLite persistence
```

## Extending

The modular architecture allows swapping components:

- **Wake word**: Implement `WakeWordDetector` interface
- **STT**: Implement `SpeechToText` interface
- **TTS**: Implement `TextToSpeech` interface
- **Audio I/O**: Implement `AudioInput`/`AudioOutput` interfaces

## License

MIT-0
