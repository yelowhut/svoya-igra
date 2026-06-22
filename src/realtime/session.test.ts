import { describe, it, expect } from 'vitest';
import { SessionRegistry } from './session.js';

describe('SessionRegistry', () => {
  it('bind и поиск по токену/сокету', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    expect(r.byToken('tok')?.playerId).toBe('pl1');
    expect(r.bySocket('sock1')?.clientToken).toBe('tok');
  });

  it('markDisconnected снимает сокет, сессия по токену жива', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    r.markDisconnected('sock1');
    expect(r.bySocket('sock1')).toBeUndefined();
    expect(r.byToken('tok')?.socketId).toBeNull();
  });

  it('повторный bind того же токена обновляет сокет (реконнект)', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player');
    r.bind('tok', 'sock2', 'pl1', 'player');
    expect(r.byToken('tok')?.socketId).toBe('sock2');
    expect(r.bySocket('sock1')).toBeUndefined();
  });

  it('bind сохраняет gameId и переносит его при реконнекте', () => {
    const r = new SessionRegistry();
    r.bind('tok', 'sock1', 'pl1', 'player', 'game42');
    expect(r.byToken('tok')?.gameId).toBe('game42');
    // при реконнекте без gameId — gameId сохраняется из предыдущей сессии
    r.markDisconnected('sock1');
    r.bind('tok', 'sock2', 'pl1', 'player');
    expect(r.byToken('tok')?.gameId).toBe('game42');
  });
});
