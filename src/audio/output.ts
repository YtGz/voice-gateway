import { PvSpeaker } from "@picovoice/pvspeaker-node";
import type { AudioOutput } from "../types";

export class PvSpeakerOutput implements AudioOutput {
  private speaker: PvSpeaker | null = null;
  private sampleRate: number;
  private deviceIndex: number;

  constructor(sampleRate: number = 22050, deviceIndex: number = -1) {
    this.sampleRate = sampleRate;
    this.deviceIndex = deviceIndex;
  }

  private ensureInitialized(): PvSpeaker {
    if (!this.speaker) {
      const options = this.deviceIndex >= 0 ? { deviceIndex: this.deviceIndex } : undefined;
      this.speaker = new PvSpeaker(this.sampleRate, 16, options);
    }
    return this.speaker;
  }

  async play(pcm: Int16Array): Promise<void> {
    const speaker = this.ensureInitialized();
    
    speaker.start();
    
    try {
      const buffer = pcm.buffer.slice(
        pcm.byteOffset,
        pcm.byteOffset + pcm.byteLength
      );
      speaker.write(buffer);
      speaker.flush();
    } finally {
      speaker.stop();
    }
  }

  stop(): void {
    if (this.speaker) {
      this.speaker.stop();
    }
  }

  release(): void {
    if (this.speaker) {
      this.speaker.release();
      this.speaker = null;
    }
  }

  static listDevices(): string[] {
    return PvSpeaker.getAvailableDevices();
  }
}
