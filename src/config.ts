import path from "path";
import fs from "fs";
import type { AppConfig, CharacterMapping } from "./types";

export type WakeWordEngine = "porcupine" | "openwakeword";

export interface OpenWakeWordConfig {
  pythonPath: string;
  vadThreshold: number;
  noiseSuppression: boolean;
}

export function loadConfig(): AppConfig {
  const wakewordEngine = (process.env.WAKEWORD_ENGINE ?? "porcupine") as WakeWordEngine;
  
  const accessKey = process.env.PICOVOICE_ACCESS_KEY;
  if (wakewordEngine === "porcupine" && !accessKey) {
    throw new Error("PICOVOICE_ACCESS_KEY environment variable is required for Porcupine");
  }

  const wsUrl = process.env.SILLYTAVERN_WS_URL ?? "ws://localhost:8000/ws/voice";
  const deviceIndex = parseInt(process.env.AUDIO_DEVICE_INDEX ?? "-1", 10);
  const outputDeviceIndex = parseInt(process.env.AUDIO_OUTPUT_DEVICE_INDEX ?? "-1", 10);
  const sensitivity = parseFloat(process.env.WAKE_WORD_SENSITIVITY ?? "0.5");
  const wakewordsDir = process.env.WAKEWORDS_DIR ?? "./wakewords";

  const characterMappings = loadCharacterMappings(wakewordsDir, sensitivity, wakewordEngine);

  const openWakeWordConfig: OpenWakeWordConfig = {
    pythonPath: process.env.OPENWAKEWORD_PYTHON_PATH ?? "python3",
    vadThreshold: parseFloat(process.env.OPENWAKEWORD_VAD_THRESHOLD ?? "0"),
    noiseSuppression: process.env.OPENWAKEWORD_NOISE_SUPPRESSION === "true",
  };

  return {
    picovoiceAccessKey: accessKey ?? "",
    sillyTavernWsUrl: wsUrl,
    audioDeviceIndex: deviceIndex,
    audioOutputDeviceIndex: outputDeviceIndex,
    wakeWordSensitivity: sensitivity,
    wakewordEngine,
    wakewordsDir,
    characterMappings,
    openWakeWordConfig,
  };
}

function loadCharacterMappings(
  wakewordsDir: string, 
  defaultSensitivity: number,
  engine: WakeWordEngine
): CharacterMapping[] {
  const absolutePath = path.resolve(wakewordsDir);
  
  if (!fs.existsSync(absolutePath)) {
    console.warn(`Wakewords directory not found: ${absolutePath}`);
    return [];
  }

  const extensions = engine === "porcupine" 
    ? [".ppn"] 
    : [".onnx", ".tflite"];
  
  const files = fs.readdirSync(absolutePath).filter((f) => 
    extensions.some((ext) => f.endsWith(ext))
  );
  
  return files.map((file) => {
    const ext = extensions.find((e) => file.endsWith(e)) ?? "";
    const baseName = path.basename(file, ext);
    const characterName = baseName
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

    return {
      keyword: baseName,
      keywordPath: path.join(absolutePath, file),
      characterName,
      sensitivity: defaultSensitivity,
    };
  });
}

export function loadMappingsFile(filePath: string): CharacterMapping[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as CharacterMapping[];
}
