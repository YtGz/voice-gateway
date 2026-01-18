import "@dotenvx/dotenvx/config";

import { loadConfig } from "./config";
import { PorcupineWakeWord } from "./wakeword";
import { CheetahSTT } from "./stt";
import { OrcaTTS } from "./tts";
import { SillyTavernWsClient } from "./sillytavern";
import { PvRecorderInput, SpeakerOutput } from "./audio";
import { getLastCharacter, setLastCharacter, closeDb } from "./db";

enum State {
  LISTENING_FOR_WAKE_WORD = "LISTENING_FOR_WAKE_WORD",
  LISTENING_FOR_SPEECH = "LISTENING_FOR_SPEECH",
  PROCESSING = "PROCESSING",
  SPEAKING = "SPEAKING",
}

async function main() {
  if (process.argv.includes("--list-devices")) {
    console.log("Available audio devices:");
    PvRecorderInput.listDevices().forEach((device, i) => {
      console.log(`  [${i}] ${device}`);
    });
    return;
  }

  const config = loadConfig();

  if (config.characterMappings.length === 0) {
    console.error("No wake word files found in:", config.wakewordsDir);
    console.error("Please add .ppn files for your characters.");
    console.error("Create custom wake words at: https://console.picovoice.ai/");
    process.exit(1);
  }

  console.log("Initializing Voice Gateway...");
  console.log("Characters configured:");
  config.characterMappings.forEach((m) => {
    console.log(`  - "${m.keyword}" → ${m.characterName}`);
  });

  const wakeWord = new PorcupineWakeWord(config.picovoiceAccessKey, config.characterMappings);
  const stt = new CheetahSTT(config.picovoiceAccessKey);
  const tts = new OrcaTTS(config.picovoiceAccessKey);
  const stClient = new SillyTavernWsClient(config.sillyTavernWsUrl);
  const audioInput = new PvRecorderInput(config.audioDeviceIndex);
  const audioOutput = new SpeakerOutput(22050);

  let state = State.LISTENING_FOR_WAKE_WORD;
  let targetCharacter: string | null = null;
  let transcriptBuffer = "";
  let silenceFrames = 0;
  const SILENCE_THRESHOLD = 30;

  const cleanup = () => {
    console.log("\nShutting down...");
    audioInput.release();
    wakeWord.release();
    stt.release();
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

    wakeWord.onWakeWord((characterName) => {
      if (state !== State.LISTENING_FOR_WAKE_WORD) return;

      console.log(`\nWake word detected: ${characterName}`);
      targetCharacter = characterName;
      state = State.LISTENING_FOR_SPEECH;
      transcriptBuffer = "";
      silenceFrames = 0;
    });

    stt.onTranscript((transcript, isFinal) => {
      if (state !== State.LISTENING_FOR_SPEECH) return;

      if (transcript) {
        transcriptBuffer += transcript;
        silenceFrames = 0;
        process.stdout.write(`\rTranscribing: ${transcriptBuffer}`);
      }

      if (isFinal && transcriptBuffer.trim()) {
        console.log(`\nFinal transcript: ${transcriptBuffer}`);
        processUserInput(transcriptBuffer.trim());
        transcriptBuffer = "";
      }
    });

    async function processUserInput(text: string) {
      if (!targetCharacter) return;

      state = State.PROCESSING;
      console.log(`Processing: "${text}" for ${targetCharacter}`);

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
        
        silenceFrames++;
        if (silenceFrames > SILENCE_THRESHOLD && transcriptBuffer.trim()) {
          const finalText = stt.flush();
          if (finalText) {
            transcriptBuffer += finalText;
          }
          if (transcriptBuffer.trim()) {
            console.log(`\nFinal transcript (silence): ${transcriptBuffer}`);
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
