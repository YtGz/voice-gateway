import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? process.cwd();
const DB_PATH = path.join(DATA_DIR, "voice-gateway.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const database = db!;
  database.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
}

export function getLastCharacter(): string | null {
  const database = getDb();
  const row = database
    .prepare("SELECT value FROM state WHERE key = ?")
    .get("last_character") as { value: string } | undefined;
  return row?.value ?? null;
}

export function setLastCharacter(characterName: string): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO state (key, value, updated_at) 
       VALUES (?, ?, strftime('%s', 'now'))
       ON CONFLICT(key) DO UPDATE SET 
         value = excluded.value,
         updated_at = strftime('%s', 'now')`)
    .run("last_character", characterName);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
