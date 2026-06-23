import type { Db } from './db.js';
import type { GameTemplate } from '../packs/templateTypes.js';
import { makeDefaultTemplate } from '../packs/templateTypes.js';

export function createTemplate(db: Db, opts: { template?: '5x5' }): { id: string } {
  const doc = makeDefaultTemplate({ template: opts.template });
  db.prepare('INSERT INTO game_templates (id,data,updated_at) VALUES (?,?,?)')
    .run(doc.id, JSON.stringify(doc), Date.now());
  return { id: doc.id };
}

export function getTemplate(db: Db, id: string): GameTemplate | null {
  const row = db.prepare('SELECT data FROM game_templates WHERE id=?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as GameTemplate) : null;
}

export function listTemplates(db: Db): { id: string; title: string; updatedAt: number }[] {
  const rows = db.prepare('SELECT id,data,updated_at FROM game_templates ORDER BY updated_at DESC')
    .all() as Array<{ id: string; data: string; updated_at: number }>;
  return rows.map(r => ({ id: r.id, title: (JSON.parse(r.data) as GameTemplate).title, updatedAt: r.updated_at }));
}

export function saveTemplate(db: Db, id: string, doc: GameTemplate): boolean {
  return db.prepare('UPDATE game_templates SET data=?, updated_at=? WHERE id=?')
    .run(JSON.stringify({ ...doc, id }), Date.now(), id).changes > 0;
}

export function deleteTemplate(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM game_templates WHERE id=?').run(id).changes > 0;
}
