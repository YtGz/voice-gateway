import "@dotenvx/dotenvx/config";

import { loadConfig } from "./config";
import { PorcupineWakeWord, OpenWakeWord } from "./wakeword";
import { CheetahSTT } from "./stt";
import { OrcaTTS } from "./tts";
import { CobraVAD } from "./vad";
import { SillyTavernWsClient } from "./sillytavern";
import { PvRecorderInput, PvSpeakerOutput, resolveInputDevice, resolveOutputDevice } from "./audio";
import { getLastCharacter, setLastCharacter, closeDb } from "./db";
import type { WakeWordDetector } from "./types";

enum State {
  LISTENING_FOR_WAKE_WORD = "LISTENING_FOR_WAKE_WORD",
  LISTENING_FOR_SPEECH = "LISTENING_FOR_SPEECH",
  PROCESSING = "PROCESSING",
  SPEAKING = "SPEAKING",
}

async function main() {
  if (process.argv.includes("--list-devices")) {
    const inputDevices = PvRecorderInput.listDevices();
    const outputDevices = PvSpeakerOutput.listDevices();
    const preferredInput = resolveInputDevice(-1);
    const preferredOutput = resolveOutputDevice(-1);
    
    console.log("Available audio input devices:");
    inputDevices.forEach((device, i) => {
      const marker = i === preferredInput.index ? " ← auto-detected" : "";
      console.log(`  [${i}] ${device}${marker}`);
    });
    console.log("\nAvailable audio output devices:");
    outputDevices.forEach((device, i) => {
      const marker = i === preferredOutput.index ? " ← auto-detected" : "";
      console.log(`  [${i}] ${device}${marker}`);
    });
    return;
  }

  const config = loadConfig();

  if (config.characterMappings.length === 0 && config.wakewordEngine === "porcupine") {
    console.error("No wake word files found in:", config.wakewordsDir);
    console.error("Please add .ppn files for your characters.");
    console.error("Create custom wake words at: https://console.picovoice.ai/");
    process.exit(1);
  }

  console.log("Initializing Voice Gateway...");
  console.log(`Wake word engine: ${config.wakewordEngine}`);
  
  if (config.characterMappings.length > 0) {
    console.log("Characters configured:");
    config.characterMappings.forEach((m) => {
      console.log(`  - "${m.keyword}" → ${m.characterName}`);
    });
  } else if (config.wakewordEngine === "openwakeword") {
    console.log("Using pre-trained openWakeWord models");
  }

  const inputDevice = resolveInputDevice(config.audioDeviceIndex);
  const outputDevice = resolveOutputDevice(config.audioOutputDeviceIndex);
  
  console.log(`Audio input: ${inputDevice.name}${inputDevice.index >= 0 ? ` [${inputDevice.index}]` : ""}`);
  console.log(`Audio output: ${outputDevice.name}${outputDevice.index >= 0 ? ` [${outputDevice.index}]` : ""}`);

  let wakeWord: WakeWordDetector & { processAudio(frame: Int16Array): number };
  
  if (config.wakewordEngine === "openwakeword") {
    wakeWord = new OpenWakeWord(config.characterMappings, {
      pythonPath: config.openWakeWordConfig.pythonPath,
      threshold: config.wakeWordSensitivity,
      vadThreshold: config.openWakeWordConfig.vadThreshold,
      noiseSuppression: config.openWakeWordConfig.noiseSuppression,
    });
  } else {
    wakeWord = new PorcupineWakeWord(config.picovoiceAccessKey, config.characterMappings);
  }

  const stt = new CheetahSTT(config.picovoiceAccessKey);
  const vad = new CobraVAD(config.picovoiceAccessKey, {
    voiceThreshold: 0.7,
    silenceThreshold: 0.3,
    silenceDurationMs: 400,
    minSpeechDurationMs: 200,
  });
  const tts = new OrcaTTS(config.picovoiceAccessKey);
  const stClient = new SillyTavernWsClient(config.sillyTavernWsUrl);
  const audioInput = new PvRecorderInput(inputDevice.index);
  const audioOutput = new PvSpeakerOutput(22050, outputDevice.index);

  let state = State.LISTENING_FOR_WAKE_WORD;
  let targetCharacter: string | null = null;
  let transcriptBuffer = "";

  const cleanup = () => {
    console.log("\nShutting down...");
    audioInput.release();
    wakeWord.release();
    stt.release();
    vad.release();
    tts.release();
    stClient.disconnect();
    audioOutput.release();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    console.log("Connecting to SillyTavern...");
    await stClient.connect();
    console.log("Connected to SillyTavern");

    const lastChar = getLastCharacter();
    if (lastChar) {
      console.log(`Restoring last character: ${lastChar}`);
      await stClient.switchCharacter(lastChar);
    }

    await wakeWord.start();
    stt.start();
    vad.start();

    wakeWord.onWakeWord((characterName) => {
      if (state !== State.LISTENING_FOR_WAKE_WORD) return;

      console.log(`\nWake word detected: ${characterName}`);
      targetCharacter = characterName;
      state = State.LISTENING_FOR_SPEECH;
      transcriptBuffer = "";
      vad.reset();
    });

    stt.onTranscript((transcript, isFinal) => {
      if (state !== State.LISTENING_FOR_SPEECH) return;

      if (transcript) {
        transcriptBuffer += transcript;
        process.stdout.write(`\rTranscribing: ${transcriptBuffer}`);
      }
    });

    async function processUserInput(text: string) {
      if (!targetCharacter) return;

      state = State.PROCESSING;
      console.log(`\nProcessing: "${text}" for ${targetCharacter}`);

      try {
        const currentChar = stClient.getCurrentCharacter();
        if (currentChar !== targetCharacter) {
          console.log(`Switching to character: ${targetCharacter}`);
          await stClient.switchCharacter(targetCharacter);
          setLastCharacter(targetCharacter);
        }

        state = State.SPEAKING;

        const responseChunks: string[] = [];
        for await (const chunk of stClient.sendMessage(text)) {
          responseChunks.push(chunk);
          process.stdout.write(chunk);
        }
        console.log();

        const fullResponse = responseChunks.join("");
        
        if (fullResponse) {
          console.log("Generating speech...");
          const pcm = await tts.synthesize(fullResponse);
          await audioOutput.play(pcm);
        }
      } catch (err) {
        console.error("Error processing message:", err);
      } finally {
        state = State.LISTENING_FOR_WAKE_WORD;
        targetCharacter = null;
      }
    }

    audioInput.onAudio((frame) => {
      if (state === State.LISTENING_FOR_WAKE_WORD) {
        wakeWord.processAudio(frame);
      } else if (state === State.LISTENING_FOR_SPEECH) {
        stt.processAudio(frame);
        
        const { isSpeaking, shouldFinalize } = vad.processAudio(frame);
        
        if (shouldFinalize && transcriptBuffer.trim()) {
          const finalText = stt.flush();
          if (finalText) {
            transcriptBuffer += finalText;
          }
          if (transcriptBuffer.trim()) {
            processUserInput(transcriptBuffer.trim());
            transcriptBuffer = "";
          }
        }
      }
    });

    audioInput.start();
    console.log("\nListening for wake words...");
    console.log("Say a character name to start talking.");

    await new Promise(() => {});
  } catch (err) {
    console.error("Fatal error:", err);
    cleanup();
  }
}

main();
