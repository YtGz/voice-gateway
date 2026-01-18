import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "voice-gateway.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
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
         updated_at = strftime('%s', 'now')`
    )
    .run("last_character", characterName);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
