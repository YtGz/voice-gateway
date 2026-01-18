import { PvRecorder } from "@picovoice/pvrecorder-node";
import type { AudioInput } from "../types";

export class PvRecorderInput implements AudioInput {
  private recorder: PvRecorder | null = null;
  private deviceIndex: number;
  private frameLength: number;
  private callback: ((frame: Int16Array) => void) | null = null;
  private running = false;

  constructor(deviceIndex: number = 0, frameLength: number = 512) {
    this.deviceIndex = deviceIndex;
    this.frameLength = frameLength;
  }

  start(): void {
    if (this.recorder) return;

    this.recorder = new PvRecorder(this.frameLength, this.deviceIndex);
    this.recorder.start();
    this.running = true;
    this.readLoop();
  }

  private async readLoop(): Promise<void> {
    while (this.running && this.recorder) {
      try {
        const frame = await this.recorder.read();
        if (this.callback && this.running) {
          this.callback(frame);
        }
      } catch (err) {
        if (this.running) {
          console.error("Audio read error:", err);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.recorder) {
      this.recorder.stop();
    }
  }

  onAudio(callback: (frame: Int16Array) => void): void {
    this.callback = callback;
  }

  getFrameLength(): number {
    return this.frameLength;
  }

  getSampleRate(): number {
    return 16000;
  }

  release(): void {
    this.stop();
    if (this.recorder) {
      this.recorder.release();
      this.recorder = null;
    }
  }

  static listDevices(): string[] {
    return PvRecorder.getAvailableDevices();
  }
}
