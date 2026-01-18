import { Orca, OrcaStream } from "@picovoice/orca-node";
import type { TextToSpeech } from "../types";

export class OrcaTTS implements TextToSpeech {
  private orca: Orca | null = null;
  private accessKey: string;
  private modelPath?: string;

  constructor(accessKey: string, modelPath?: string) {
    this.accessKey = accessKey;
    this.modelPath = modelPath;
  }

  private ensureInitialized(): Orca {
    if (!this.orca) {
      const options = this.modelPath ? { modelPath: this.modelPath } : undefined;
      this.orca = new Orca(this.accessKey, options);
    }
    return this.orca;
  }

  async *synthesizeStream(textChunks: AsyncIterable<string>): AsyncIterable<Int16Array> {
    const orca = this.ensureInitialized();
    const stream = orca.streamOpen();

    try {
      for await (const chunk of textChunks) {
        const pcm = stream.synthesize(chunk);
        if (pcm !== null) {
          yield pcm;
        }
      }

      const finalPcm = stream.flush();
      if (finalPcm !== null) {
        yield finalPcm;
      }
    } finally {
      stream.close();
    }
  }

  async synthesize(text: string): Promise<Int16Array> {
    const orca = this.ensureInitialized();
    const { pcm } = orca.synthesize(text);
    return pcm;
  }

  getSampleRate(): number {
    const orca = this.ensureInitialized();
    return orca.sampleRate;
  }

  release(): void {
    if (this.orca) {
      this.orca.release();
      this.orca = null;
    }
  }
}
