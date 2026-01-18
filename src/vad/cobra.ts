import { Cobra } from "@picovoice/cobra-node";

export interface VADConfig {
  voiceThreshold: number;
  silenceThreshold: number;
  silenceDurationMs: number;
  minSpeechDurationMs: number;
}

const DEFAULT_CONFIG: VADConfig = {
  voiceThreshold: 0.7,
  silenceThreshold: 0.3,
  silenceDurationMs: 400,
  minSpeechDurationMs: 200,
};

export class CobraVAD {
  private cobra: Cobra | null = null;
  private accessKey: string;
  private config: VADConfig;

  private speaking = false;
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private lastVoiceProbability = 0;

  constructor(accessKey: string, config: Partial<VADConfig> = {}) {
    this.accessKey = accessKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    if (this.cobra) return;
    this.cobra = new Cobra(this.accessKey);
    this.reset();
  }

  reset(): void {
    this.speaking = false;
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    this.lastVoiceProbability = 0;
  }

  processAudio(frame: Int16Array): {
    voiceProbability: number;
    isSpeaking: boolean;
    shouldFinalize: boolean;
  } {
    if (!this.cobra) {
      return { voiceProbability: 0, isSpeaking: false, shouldFinalize: false };
    }

    const now = Date.now();
    const voiceProbability = this.cobra.process(frame);
    this.lastVoiceProbability = voiceProbability;

    const isVoice = voiceProbability >= this.config.voiceThreshold;
    const isSilence = voiceProbability < this.config.silenceThreshold;

    if (isVoice && !this.speaking) {
      this.speaking = true;
      this.speechStartTime = now;
      this.silenceStartTime = 0;
    }

    if (this.speaking && isSilence) {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      }
    } else if (this.speaking && isVoice) {
      this.silenceStartTime = 0;
    }

    const speechDuration = this.speaking ? now - this.speechStartTime : 0;
    const silenceDuration = this.silenceStartTime > 0 ? now - this.silenceStartTime : 0;

    const hasMinSpeech = speechDuration >= this.config.minSpeechDurationMs;
    const hasSufficientSilence = silenceDuration >= this.config.silenceDurationMs;
    const shouldFinalize = this.speaking && hasMinSpeech && hasSufficientSilence;

    return {
      voiceProbability,
      isSpeaking: this.speaking,
      shouldFinalize,
    };
  }

  getFrameLength(): number {
    return this.cobra?.frameLength ?? 512;
  }

  getSampleRate(): number {
    return this.cobra?.sampleRate ?? 16000;
  }

  release(): void {
    if (this.cobra) {
      this.cobra.release();
      this.cobra = null;
    }
  }
}
