import WebSocket from "ws";
import type { SillyTavernClient } from "../types";

interface STMessage {
  type: string;
  [key: string]: unknown;
}

export class SillyTavernWsClient implements SillyTavernClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private currentCharacter: string | null = null;
  private headlessReady = false;
  private connected = false;
  private readyCallback: (() => void) | null = null;
  private messageResolvers: Map<string, (msg: STMessage) => void> = new Map();

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        this.connected = true;
      });

      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as STMessage;
        this.handleMessage(msg);
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.headlessReady = false;
      });

      this.ws.on("error", (err) => {
        reject(err);
      });

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 30000);

      const checkReady = setInterval(() => {
        if (this.headlessReady) {
          clearInterval(checkReady);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  private handleMessage(msg: STMessage): void {
    if (msg.type === "status") {
      this.headlessReady = msg.headlessReady as boolean;
      this.currentCharacter = (msg.character as string) || null;
      if (this.headlessReady && this.readyCallback) {
        this.readyCallback();
      }
    }

    if (msg.type === "character_switched") {
      this.currentCharacter = msg.character as string;
    }

    for (const [key, resolver] of this.messageResolvers) {
      if (msg.type === key) {
        resolver(msg);
        this.messageResolvers.delete(key);
      }
    }
  }

  private send(action: string, data: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify({ action, ...data }));
  }

  private waitForMessage(type: string, timeout = 10000): Promise<STMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageResolvers.delete(type);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeout);

      this.messageResolvers.set(type, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.headlessReady = false;
  }

  async switchCharacter(name: string): Promise<void> {
    this.send("switch", { character: name });
    await this.waitForMessage("character_switched");
  }

  async *sendMessage(text: string): AsyncIterable<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this.send("message", { text });

    while (true) {
      const msg = await new Promise<STMessage>((resolve) => {
        const handler = (data: WebSocket.Data) => {
          const parsed = JSON.parse(data.toString()) as STMessage;
          if (parsed.type === "chunk" || parsed.type === "end" || parsed.type === "error") {
            this.ws?.off("message", handler);
            resolve(parsed);
          }
        };
        this.ws?.on("message", handler);
      });

      if (msg.type === "chunk") {
        yield msg.text as string;
      } else if (msg.type === "end") {
        break;
      } else if (msg.type === "error") {
        throw new Error(msg.message as string);
      }
    }
  }

  async getCharacters(): Promise<string[]> {
    this.send("characters");
    const msg = await this.waitForMessage("characters");
    const characters = msg.characters as Array<{ name: string }>;
    return characters.map((c) => c.name);
  }

  getCurrentCharacter(): string | null {
    return this.currentCharacter;
  }

  onReady(callback: () => void): void {
    this.readyCallback = callback;
    if (this.headlessReady) {
      callback();
    }
  }

  isReady(): boolean {
    return this.connected && this.headlessReady;
  }
}
