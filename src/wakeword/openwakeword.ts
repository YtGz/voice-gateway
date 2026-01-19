import { spawn, ChildProcess } from "child_process";
import { createInterface, Interface } from "readline";
import path from "path";
import type { WakeWordDetector } from "../types";

interface OpenWakeWordConfig {
  pythonPath?: string;
  wakewordsDir?: string;
  characters?: string[];
  threshold?: number;
  frameSize?: number;
  vadThreshold?: number;
  noiseSuppression?: boolean;
}

interface DetectionEvent {
  type: "detection";
  model: string;
  score: number;
}

interface ReadyEvent {
  type: "ready";
  models: string[];
}

interface ErrorEvent {
  type: "error";
  message: string;
}

interface WarningEvent {
  type: "warning";
  message: string;
}

type ServerEvent = DetectionEvent | ReadyEvent | ErrorEvent | WarningEvent;

export class OpenWakeWord implements WakeWordDetector {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private callback: ((keyword: string) => void) | null = null;
  private config: OpenWakeWordConfig;
  private audioBuffer: Buffer = Buffer.alloc(0);
  private frameSize: number;
  private running = false;

  constructor(config: OpenWakeWordConfig = {}) {
    this.config = config;
    this.frameSize = config.frameSize ?? 1280;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const scriptPath = path.join(__dirname, "../../scripts/openwakeword_server.py");
    const pythonPath = this.config.pythonPath ?? "python3";

    const args = [scriptPath];
    
    if (this.config.wakewordsDir) {
      args.push("--wakewords-dir", this.config.wakewordsDir);
    }
    
    if (this.config.characters && this.config.characters.length > 0) {
      args.push("--characters", ...this.config.characters);
    }
    
    if (this.config.threshold !== undefined) {
      args.push("--threshold", this.config.threshold.toString());
    }
    
    args.push("--frame-size", this.frameSize.toString());
    
    if (this.config.vadThreshold !== undefined && this.config.vadThreshold > 0) {
      args.push("--vad-threshold", this.config.vadThreshold.toString());
    }
    
    if (this.config.noiseSuppression) {
      args.push("--noise-suppression");
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(pythonPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start openWakeWord: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        if (this.running) {
          console.error(`openWakeWord process exited with code ${code}`);
        }
        this.process = null;
        this.readline = null;
      });

      this.process.stderr?.on("data", (data) => {
        console.error(`openWakeWord stderr: ${data}`);
      });

      this.readline = createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      this.readline.on("line", (line) => {
        try {
          const event = JSON.parse(line) as ServerEvent;
          this.handleEvent(event, resolve);
        } catch (err) {
          console.error("Failed to parse openWakeWord output:", line);
        }
      });

      this.running = true;

      setTimeout(() => {
        reject(new Error("openWakeWord startup timeout"));
      }, 30000);
    });
  }

  private handleEvent(event: ServerEvent, onReady?: (value: void) => void): void {
    switch (event.type) {
      case "ready":
        console.log(`openWakeWord ready with models: ${event.models.join(", ")}`);
        if (onReady) onReady();
        break;

      case "detection":
        if (this.callback) {
          this.callback(event.model);
        }
        break;

      case "error":
        console.error(`openWakeWord error: ${event.message}`);
        break;

      case "warning":
        console.warn(`openWakeWord warning: ${event.message}`);
        break;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onWakeWord(callback: (keyword: string) => void): void {
    this.callback = callback;
  }

  processAudio(frame: Int16Array): number {
    if (!this.process || !this.running) return -1;

    const frameBuffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    this.audioBuffer = Buffer.concat([this.audioBuffer, frameBuffer]);

    const frameSizeBytes = this.frameSize * 2;
    
    while (this.audioBuffer.length >= frameSizeBytes) {
      const chunk = this.audioBuffer.subarray(0, frameSizeBytes);
      this.audioBuffer = this.audioBuffer.subarray(frameSizeBytes);
      
      try {
        this.process.stdin?.write(chunk);
      } catch (err) {
        console.error("Failed to write to openWakeWord:", err);
        return -1;
      }
    }

    return -1;
  }

  getFrameLength(): number {
    return this.frameSize;
  }

  getSampleRate(): number {
    return 16000;
  }

  release(): void {
    this.running = false;
    
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    
    this.audioBuffer = Buffer.alloc(0);
  }
}
