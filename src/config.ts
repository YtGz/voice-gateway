import path from "path";
import fs from "fs";
import type { AppConfig, CharacterMapping } from "../types";

export function loadConfig(): AppConfig {
  const accessKey = process.env.PICOVOICE_ACCESS_KEY;
  if (!accessKey) {
    throw new Error("PICOVOICE_ACCESS_KEY environment variable is required");
  }

  const wsUrl = process.env.SILLYTAVERN_WS_URL ?? "ws://localhost:8000/ws/voice";
  const deviceIndex = parseInt(process.env.AUDIO_DEVICE_INDEX ?? "-1", 10);
  const outputDeviceIndex = parseInt(process.env.AUDIO_OUTPUT_DEVICE_INDEX ?? "-1", 10);
  const sensitivity = parseFloat(process.env.WAKE_WORD_SENSITIVITY ?? "0.5");
  const wakewordsDir = process.env.WAKEWORDS_DIR ?? "./wakewords";

  const characterMappings = loadCharacterMappings(wakewordsDir, sensitivity);

  return {
    picovoiceAccessKey: accessKey,
    sillyTavernWsUrl: wsUrl,
    audioDeviceIndex: deviceIndex,
    audioOutputDeviceIndex: outputDeviceIndex,
    wakeWordSensitivity: sensitivity,
    wakewordsDir,
    characterMappings,
  };
}

function loadCharacterMappings(wakewordsDir: string, defaultSensitivity: number): CharacterMapping[] {
  const absolutePath = path.resolve(wakewordsDir);
  
  if (!fs.existsSync(absolutePath)) {
    console.warn(`Wakewords directory not found: ${absolutePath}`);
    return [];
  }

  const files = fs.readdirSync(absolutePath).filter((f) => f.endsWith(".ppn"));
  
  return files.map((file) => {
    const baseName = path.basename(file, ".ppn");
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
