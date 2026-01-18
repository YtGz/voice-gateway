import { Cheetah } from "@picovoice/cheetah-node";
import type { SpeechToText } from "../types";

export class CheetahSTT implements SpeechToText {
  private cheetah: Cheetah | null = null;
  private accessKey: string;
  private callback: ((transcript: string, isFinal: boolean) => void) | null = null;
  private running = false;
  private modelPath?: string;

  constructor(accessKey: string, modelPath?: string) {
    this.accessKey = accessKey;
    this.modelPath = modelPath;
  }

  start(): void {
    if (this.cheetah) return;

    const options = this.modelPath ? { modelPath: this.modelPath } : undefined;
    this.cheetah = new Cheetah(this.accessKey, options);
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  processAudio(frame: Int16Array): void {
    if (!this.cheetah || !this.running) return;

    const [partialTranscript, isEndpoint] = this.cheetah.process(frame);

    if (partialTranscript && this.callback) {
      this.callback(partialTranscript, false);
    }

    if (isEndpoint) {
      const finalTranscript = this.cheetah.flush();
      if (finalTranscript && this.callback) {
        this.callback(finalTranscript, true);
      }
    }
  }

  onTranscript(callback: (transcript: string, isFinal: boolean) => void): void {
    this.callback = callback;
  }

  flush(): string {
    if (!this.cheetah) return "";
    return this.cheetah.flush();
  }

  getFrameLength(): number {
    return this.cheetah?.frameLength ?? 512;
  }

  getSampleRate(): number {
    return this.cheetah?.sampleRate ?? 16000;
  }

  release(): void {
    if (this.cheetah) {
      this.cheetah.release();
      this.cheetah = null;
    }
    this.running = false;
  }
}
