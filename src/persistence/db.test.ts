import { describe, it, expect } from 'vitest';
import { openDb } from './db.js';

describe('openDb', () => {
  it('создаёт таблицы events/snapshots/packs', () => {
    const db = openDb(':memory:');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('events');
    expect(names).toContain('snapshots');
    expect(names).toContain('packs');
  });

  it('event_id уникален', () => {
    const db = openDb(':memory:');
    const ins = db.prepare("INSERT INTO events (game_id,event_id,type,payload) VALUES (?,?,?,?)");
    ins.run('g', 'e1', 'X', '{}');
    expect(() => ins.run('g', 'e1', 'X', '{}')).toThrow();
  });
});

describe('миграция game_templates', () => {
  it('таблица существует и принимает вставку', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO game_templates (id,data,updated_at) VALUES (?,?,?)').run('t1', '{}', 1);
    const row = db.prepare('SELECT id,data,updated_at FROM game_templates WHERE id=?').get('t1');
    expect(row).toEqual({ id: 't1', data: '{}', updated_at: 1 });
  });
});
