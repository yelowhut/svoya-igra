import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../../src/persistence/db.js';
import { EventStore } from '../../src/persistence/eventStore.js';
import { makeEvent } from '../../src/domain/events.js';

const DB = join(process.cwd(), 'data', 'recovery-test.db');
afterEach(() => {
  try {
    rmSync(DB, { force: true });
    rmSync(`${DB}-shm`, { force: true });
    rmSync(`${DB}-wal`, { force: true });
  } catch {}
});

describe('восстановление', () => {
  it('новый EventStore на том же файле восстанавливает счёт и фазу', () => {
    let n = 0; const id = () => `e${n++}`;
    {
      const db = openDb(DB);
      const store = new EventStore(db, 2);
      store.append('g', makeEvent('GAME_CREATED', { gameId:'g', packId:'p', title:'T', teamCount:2 }, id));
      store.append('g', makeEvent('TEAM_CREATED', { teamId:'a', name:'A' }, id));
      store.append('g', makeEvent('TEAM_CREATED', { teamId:'b', name:'B' }, id));
      store.append('g', makeEvent('ROUND_STARTED', { roundIndex:0, pickingTeamId:'a' }, id));
      store.append('g', makeEvent('QUESTION_SELECTED', { questionId:'q1', value:100, special:'none' }, id));
      store.append('g', makeEvent('BUZZER_OPENED', {}, id));
      store.append('g', makeEvent('BUZZ_RECORDED', { teamId:'a', reaction:150 }, id));
      store.append('g', makeEvent('ANSWER_JUDGED', { teamId:'a', correct:true, value:100 }, id));
      db.close();
    }
    const db2 = openDb(DB);
    const restored = new EventStore(db2, 2).loadState('g');
    db2.close();
    expect(restored.teams.find(t => t.id === 'a')!.score).toBe(100);
    expect(restored.phase).toBe('JUDGED');
    expect(restored.pickingTeamId).toBe('a');
  });
});
