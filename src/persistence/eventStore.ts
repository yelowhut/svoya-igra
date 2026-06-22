import type { Db } from './db.js';
import type { GameEvent } from '../domain/events.js';
import type { GameState } from '../domain/types.js';
import { applyEvent } from '../domain/engine/reducer.js';
import { initialState } from '../domain/engine/state.js';

export class EventStore {
  private cache = new Map<string, { seq: number; state: GameState }>();
  constructor(private db: Db, private snapshotEvery: number) {}

  append(gameId: string, event: GameEvent): GameState {
    const exists = this.db.prepare('SELECT 1 FROM events WHERE event_id = ?').get(event.id);
    let cur = this.cache.get(gameId) ?? { seq: 0, state: this.loadState(gameId) };
    if (exists) { this.cache.set(gameId, cur); return cur.state; }

    const info = this.db.prepare('INSERT INTO events (game_id,event_id,type,payload) VALUES (?,?,?,?)')
      .run(gameId, event.id, event.type, JSON.stringify(event.payload));
    const seq = Number(info.lastInsertRowid);
    const state = applyEvent(cur.state, event);
    cur = { seq, state };
    this.cache.set(gameId, cur);

    if (seq % this.snapshotEvery === 0) {
      this.db.prepare('INSERT INTO snapshots (game_id,seq,state) VALUES (?,?,?)')
        .run(gameId, seq, JSON.stringify(state));
    }
    return state;
  }

  loadState(gameId: string): GameState {
    const snap = this.db.prepare(
      'SELECT seq,state FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT 1'
    ).get(gameId) as { seq: number; state: string } | undefined;

    let state = snap ? (JSON.parse(snap.state) as GameState) : initialState();
    const fromSeq = snap ? snap.seq : 0;

    const rows = this.db.prepare(
      'SELECT type,payload FROM events WHERE game_id = ? AND seq > ? ORDER BY seq ASC'
    ).all(gameId, fromSeq) as { type: string; payload: string }[];

    for (const r of rows) {
      state = applyEvent(state, { id: '', type: r.type, payload: JSON.parse(r.payload) } as GameEvent);
    }
    return state;
  }
}
