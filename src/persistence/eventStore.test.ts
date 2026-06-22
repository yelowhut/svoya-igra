import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';
import { EventStore } from './eventStore.js';
import { makeEvent } from '../domain/events.js';

let n = 0; const id = () => `e${n++}`;

describe('EventStore', () => {
  it('append применяет события и копит состояние', () => {
    const store = new EventStore(openDb(':memory:'), 25);
    store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
    const s = store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
    expect(s.teams).toHaveLength(1);
  });

  it('повторный append того же event.id идемпотентен', () => {
    const store = new EventStore(openDb(':memory:'), 25);
    const e = makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, () => 'same');
    store.append('g', e);
    const s = store.append('g', e);
    expect(s.teams).toHaveLength(1);
  });

  it('loadState восстанавливает из снэпшота + реплей хвоста', () => {
    const db = openDb(':memory:');
    const store = new EventStore(db, 2); // снэпшот каждые 2 события
    store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
    store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id)); // тут снэпшот
    store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id)); // хвост
    const fresh = new EventStore(db, 2);
    const s = fresh.loadState('g');
    expect(s.teams.map(t => t.id)).toEqual(['a', 'b']);
  });
});
