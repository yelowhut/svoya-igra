import type { Db } from './db.js';

export function setActiveGame(db: Db, gameId: string): void {
  db.prepare(
    `INSERT INTO active_game (id, game_id, activated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET game_id = excluded.game_id, activated_at = excluded.activated_at`
  ).run(gameId, Date.now());
}

export function clearActiveGame(db: Db): void {
  db.prepare(`UPDATE active_game SET game_id = NULL WHERE id = 1`).run();
}

export function clearActiveGameIfMatches(db: Db, gameId: string): void {
  db.prepare(`UPDATE active_game SET game_id = NULL WHERE id = 1 AND game_id = ?`).run(gameId);
}

export function getActiveGameId(db: Db): string | null {
  const row = db.prepare(`SELECT game_id FROM active_game WHERE id = 1`).get() as { game_id: string | null } | undefined;
  return row?.game_id ?? null;
}
