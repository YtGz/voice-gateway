import { Porcupine } from "@picovoice/porcupine-node";
import type { WakeWordDetector, CharacterMapping } from "../types";

export class PorcupineWakeWord implements WakeWordDetector {
  private porcupine: Porcupine | null = null;
  private accessKey: string;
  private characterMappings: CharacterMapping[];
  private callback: ((keyword: string) => void) | null = null;
  private running = false;

  constructor(accessKey: string, characterMappings: CharacterMapping[]) {
    this.accessKey = accessKey;
    this.characterMappings = characterMappings;
  }

  async start(): Promise<void> {
    if (this.porcupine) return;

    const keywordPaths = this.characterMappings.map((m) => m.keywordPath);
    const sensitivities = this.characterMappings.map(
      (m) => m.sensitivity ?? 0.5
    );

    this.porcupine = new Porcupine(
      this.accessKey,
      keywordPaths,
      sensitivities
    );
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onWakeWord(callback: (keyword: string) => void): void {
    this.callback = callback;
  }

  processAudio(frame: Int16Array): number {
    if (!this.porcupine || !this.running) return -1;

    const keywordIndex = this.porcupine.process(frame);
    
    if (keywordIndex >= 0 && this.callback) {
      const mapping = this.characterMappings[keywordIndex];
      this.callback(mapping.characterName);
    }

    return keywordIndex;
  }

  getFrameLength(): number {
    return this.porcupine?.frameLength ?? 512;
  }

  getSampleRate(): number {
    return this.porcupine?.sampleRate ?? 16000;
  }

  release(): void {
    if (this.porcupine) {
      this.porcupine.release();
      this.porcupine = null;
    }
    this.running = false;
  }
}
