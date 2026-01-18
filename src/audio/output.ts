import type { AudioOutput } from "../types";

export class SpeakerOutput implements AudioOutput {
  private sampleRate: number;
  private playing = false;

  constructor(sampleRate: number = 22050) {
    this.sampleRate = sampleRate;
  }

  async play(pcm: Int16Array): Promise<void> {
    this.playing = true;
    
    const wavBuffer = this.createWavBuffer(pcm);
    const tempFile = `${process.cwd()}/temp_audio_${Date.now()}.wav`;
    
    try {
      await Bun.write(tempFile, wavBuffer);
      
      const proc = Bun.spawn(["powershell", "-Command", `
        Add-Type -AssemblyName System.Speech
        $player = New-Object System.Media.SoundPlayer
        $player.SoundLocation = "${tempFile.replace(/\//g, "\\")}"
        $player.PlaySync()
      `], {
        stdout: "ignore",
        stderr: "ignore",
      });
      
      await proc.exited;
    } finally {
      try {
        const file = Bun.file(tempFile);
        if (await file.exists()) {
          await Bun.write(tempFile, "");
          const fs = await import("fs/promises");
          await fs.unlink(tempFile);
        }
      } catch {}
      this.playing = false;
    }
  }

  private createWavBuffer(pcm: Int16Array): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = this.sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcm.length * 2;
    const fileSize = 44 + dataSize;

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    buffer.write("RIFF", offset); offset += 4;
    buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
    buffer.write("WAVE", offset); offset += 4;

    buffer.write("fmt ", offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(this.sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

    buffer.write("data", offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    for (let i = 0; i < pcm.length; i++) {
      buffer.writeInt16LE(pcm[i], offset);
      offset += 2;
    }

    return buffer;
  }

  stop(): void {
    this.playing = false;
  }

  release(): void {
    this.stop();
  }
}
