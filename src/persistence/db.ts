import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      game_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
  return db;
}
