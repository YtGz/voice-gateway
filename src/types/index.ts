export interface WakeWordDetector {
  start(): Promise<void>;
  stop(): Promise<void>;
  onWakeWord(callback: (keyword: string) => void): void;
  release(): void;
}

export interface SpeechToText {
  start(): void;
  stop(): void;
  processAudio(frame: Int16Array): void;
  onTranscript(callback: (transcript: string, isFinal: boolean) => void): void;
  flush(): string;
  release(): void;
}

export interface TextToSpeech {
  synthesizeStream(text: AsyncIterable<string>): AsyncIterable<Int16Array>;
  synthesize(text: string): Promise<Int16Array>;
  release(): void;
}

export interface AudioInput {
  start(): void;
  stop(): void;
  onAudio(callback: (frame: Int16Array) => void): void;
  getFrameLength(): number;
  getSampleRate(): number;
  release(): void;
}

export interface AudioOutput {
  play(pcm: Int16Array): Promise<void>;
  stop(): void;
  release(): void;
}

export interface SillyTavernClient {
  connect(): Promise<void>;
  disconnect(): void;
  switchCharacter(name: string): Promise<void>;
  sendMessage(text: string): AsyncIterable<string>;
  getCharacters(): Promise<string[]>;
  getCurrentCharacter(): string | null;
  onReady(callback: () => void): void;
  isReady(): boolean;
}

export interface CharacterMapping {
  keyword: string;
  keywordPath: string;
  characterName: string;
  sensitivity?: number;
}

export interface AppConfig {
  picovoiceAccessKey: string;
  sillyTavernWsUrl: string;
  audioDeviceIndex: number;
  wakeWordSensitivity: number;
  wakewordsDir: string;
  characterMappings: CharacterMapping[];
}
