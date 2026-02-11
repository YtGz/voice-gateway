# Wakeword Recorder - Implementation Plan

A browser-based tool for recording multiple wake word samples with automatic voice activity detection and segmentation.

## Goal

Enable hands-free recording of 20-50+ wake word samples by automatically detecting and segmenting speech, allowing the user to move around the room and speak naturally without pressing any buttons.

## Tech Stack

- **Framework**: SvelteKit
- **Styling**: TailwindCSS
- **VAD**: `@ricky0123/vad-web` (Silero VAD for browser)
- **Audio**: Web Audio API + MediaRecorder
- **Export**: JSZip for batch download

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │ Microphone  │───▶│  VAD Engine │───▶│ Clip Segmenter  │  │
│  │  (stream)   │    │  (Silero)   │    │ (ring buffer)   │  │
│  └─────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                  │           │
│                      ┌───────────────────────────▼────────┐  │
│                      │           Clip Store               │  │
│                      │  - Preview/playback                │  │
│                      │  - Delete bad clips                │  │
│                      │  - Export as ZIP (16kHz mono WAV)  │  │
│                      └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## VAD Configuration

Using `@ricky0123/vad-web` with tuned parameters:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `preSpeechPadFrames` | 5 (~480ms) | Include audio before VAD trigger to avoid clipping word start |
| `redemptionFrames` | 8 (~768ms) | Wait before ending to avoid mid-word cuts |
| `minSpeechFrames` | 3 (~288ms) | Minimum speech duration to count as valid |
| `positiveSpeechThreshold` | 0.5 | Confidence threshold for speech detection |
| `negativeSpeechThreshold` | 0.35 | Confidence threshold for silence detection |

## Implementation Phases

### Phase 1: Project Setup
- [ ] Initialize SvelteKit project
- [ ] Add TailwindCSS
- [ ] Add dependencies (`@ricky0123/vad-web`, `jszip`, `lamejs`)
- [ ] Basic page layout

### Phase 2: Audio Capture & VAD
- [ ] Request microphone permission
- [ ] Initialize VAD with Silero model
- [ ] Display real-time audio level meter
- [ ] Show VAD state (listening/speech detected)

### Phase 3: Auto-Segmentation
- [ ] Capture audio segments on VAD speech events
- [ ] Convert to 16kHz mono WAV format
- [ ] Store clips in memory with metadata (timestamp, duration)
- [ ] Auto-increment clip counter

### Phase 4: Clip Management UI
- [ ] Display list of recorded clips
- [ ] Playback individual clips
- [ ] Delete unwanted clips
- [ ] Show waveform preview for each clip

### Phase 5: Export
- [ ] Convert all clips to 16kHz mono WAV
- [ ] Package as ZIP with numbered filenames (`real_001.wav`, `real_002.wav`, etc.)
- [ ] Download ZIP

### Phase 6: Polish
- [ ] Visual feedback during recording (pulsing indicator)
- [ ] Keyboard shortcuts (Space to pause/resume, Delete to remove last clip)
- [ ] Session persistence (localStorage backup)
- [ ] Mobile-friendly layout
- [ ] Instructions/tips overlay

## UI Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  🎙️ Wakeword Recorder                            [?] Help   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     Target word:  [ Seraphina ]                             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │              ◉ Recording... (say your wake word)      │  │
│  │                                                       │  │
│  │         ████████████░░░░░░░░░░░░  (audio level)       │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│        [ 🎤 Start Recording ]  [ ⏹️ Stop ]                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Recorded Clips: 12                    [ 📦 Export ZIP ]    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │ #12  0.8s  ▶️ ░░░█████████░░░░░░░░░░░░░  🗑️        │    │
│  │ #11  0.7s  ▶️ ░░░░███████░░░░░░░░░░░░░░  🗑️        │    │
│  │ #10  0.9s  ▶️ ░░░░░████████░░░░░░░░░░░░  🗑️        │    │
│  │ ...                                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
tools/wakeword-recorder/
├── PLAN.md
├── package.json
├── svelte.config.js
├── tailwind.config.js
├── vite.config.js
├── src/
│   ├── app.html
│   ├── app.css
│   ├── lib/
│   │   ├── components/
│   │   │   ├── AudioMeter.svelte
│   │   │   ├── ClipList.svelte
│   │   │   ├── ClipItem.svelte
│   │   │   ├── RecordButton.svelte
│   │   │   └── Waveform.svelte
│   │   ├── stores/
│   │   │   └── clips.ts
│   │   └── utils/
│   │       ├── vad.ts
│   │       ├── audio.ts
│   │       └── export.ts
│   └── routes/
│       └── +page.svelte
└── static/
    └── (VAD model files copied here)
```

## Audio Format Requirements

Output format for openWakeWord training:
- **Sample rate**: 16,000 Hz
- **Channels**: Mono
- **Bit depth**: 16-bit
- **Format**: WAV (PCM)
- **Duration**: ~0.5-2 seconds per clip

## Notes

- VAD model (~3MB) loaded on first use
- All processing happens client-side (no server upload)
- Works offline after initial load
- Clips stored in memory (refresh = lost, hence localStorage backup)
