import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import { setActiveGame, clearActiveGame, clearActiveGameIfMatches, getActiveGameId } from './activeGameRepo.js';

describe('activeGameRepo', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('по умолчанию активной игры нет', () => {
    expect(getActiveGameId(db)).toBeNull();
  });

  it('setActiveGame ставит указатель', () => {
    setActiveGame(db, 'g1');
    expect(getActiveGameId(db)).toBe('g1');
  });

  it('повторный setActiveGame перезаписывает (одна активная)', () => {
    setActiveGame(db, 'g1');
    setActiveGame(db, 'g2');
    expect(getActiveGameId(db)).toBe('g2');
  });

  it('clearActiveGame очищает', () => {
    setActiveGame(db, 'g1');
    clearActiveGame(db);
    expect(getActiveGameId(db)).toBeNull();
  });

  it('clearActiveGameIfMatches очищает только совпадающую', () => {
    setActiveGame(db, 'g1');
    clearActiveGameIfMatches(db, 'other');
    expect(getActiveGameId(db)).toBe('g1');
    clearActiveGameIfMatches(db, 'g1');
    expect(getActiveGameId(db)).toBeNull();
  });
});
