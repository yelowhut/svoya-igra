import type { Db } from './db.js';

export type QType = 'text' | 'image' | 'audio';
export interface BankCategory { id: string; name: string; position: number; questionCount: number }
export interface BankQuestion {
  id: string; categoryId: string; type: QType;
  prompt: string; answer: string; media: string | null; position: number;
}

export function createCategory(db: Db, name: string): { id: string } {
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM bank_categories').get() as { p: number }).p;
  db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run(id, name, pos);
  return { id };
}

export function listCategories(db: Db): BankCategory[] {
  return db.prepare(`
    SELECT c.id, c.name, c.position, COUNT(q.id) AS questionCount
    FROM bank_categories c
    LEFT JOIN bank_questions q ON q.category_id = c.id
    GROUP BY c.id ORDER BY c.position ASC
  `).all() as BankCategory[];
}

export function renameCategory(db: Db, id: string, name: string): boolean {
  return db.prepare('UPDATE bank_categories SET name=? WHERE id=?').run(name, id).changes > 0;
}

export function moveCategory(db: Db, id: string, direction: 'up' | 'down'): boolean {
  const cur = db.prepare('SELECT position FROM bank_categories WHERE id=?').get(id) as { position: number } | undefined;
  if (!cur) return false;
  const op = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const nb = db.prepare(`SELECT id, position FROM bank_categories WHERE position ${op} ? ORDER BY position ${order} LIMIT 1`)
    .get(cur.position) as { id: string; position: number } | undefined;
  if (!nb) return false;
  db.transaction(() => {
    db.prepare('UPDATE bank_categories SET position=? WHERE id=?').run(nb.position, id);
    db.prepare('UPDATE bank_categories SET position=? WHERE id=?').run(cur.position, nb.id);
  })();
  return true;
}

export function deleteCategory(db: Db, id: string): { found: boolean; mediaPaths: string[] } {
  const cat = db.prepare('SELECT id FROM bank_categories WHERE id=?').get(id);
  if (!cat) return { found: false, mediaPaths: [] };
  const media = (db.prepare('SELECT media FROM bank_questions WHERE category_id=? AND media IS NOT NULL').all(id) as Array<{ media: string }>)
    .map(r => r.media);
  db.transaction(() => {
    db.prepare('DELETE FROM bank_questions WHERE category_id=?').run(id);
    db.prepare('DELETE FROM bank_categories WHERE id=?').run(id);
  })();
  return { found: true, mediaPaths: media };
}

function rowToQuestion(r: any): BankQuestion {
  return { id: r.id, categoryId: r.category_id, type: r.type, prompt: r.prompt, answer: r.answer, media: r.media ?? null, position: r.position };
}

export function createQuestion(db: Db, categoryId: string): { id: string } | null {
  const cat = db.prepare('SELECT id FROM bank_categories WHERE id=?').get(categoryId);
  if (!cat) return null;
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM bank_questions WHERE category_id=?').get(categoryId) as { p: number }).p;
  db.prepare("INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,'text','','',NULL,?)")
    .run(id, categoryId, pos);
  return { id };
}

export function listQuestions(db: Db, categoryId: string): BankQuestion[] {
  return (db.prepare('SELECT * FROM bank_questions WHERE category_id=? ORDER BY position ASC').all(categoryId) as any[]).map(rowToQuestion);
}

export function getQuestion(db: Db, id: string): BankQuestion | null {
  const r = db.prepare('SELECT * FROM bank_questions WHERE id=?').get(id);
  return r ? rowToQuestion(r) : null;
}

export function updateQuestion(
  db: Db, id: string,
  fields: { type?: QType; prompt?: string; answer?: string; media?: string | null },
): boolean {
  const cur = db.prepare('SELECT * FROM bank_questions WHERE id=?').get(id) as any;
  if (!cur) return false;
  const type = fields.type ?? cur.type;
  const prompt = fields.prompt ?? cur.prompt;
  const answer = fields.answer ?? cur.answer;
  const media = 'media' in fields ? fields.media ?? null : (cur.media ?? null);
  db.prepare('UPDATE bank_questions SET type=?,prompt=?,answer=?,media=? WHERE id=?').run(type, prompt, answer, media, id);
  return true;
}

export function moveQuestion(db: Db, id: string, direction: 'up' | 'down'): boolean {
  const cur = db.prepare('SELECT category_id, position FROM bank_questions WHERE id=?').get(id) as { category_id: string; position: number } | undefined;
  if (!cur) return false;
  const op = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const nb = db.prepare(`SELECT id, position FROM bank_questions WHERE category_id=? AND position ${op} ? ORDER BY position ${order} LIMIT 1`)
    .get(cur.category_id, cur.position) as { id: string; position: number } | undefined;
  if (!nb) return false;
  db.transaction(() => {
    db.prepare('UPDATE bank_questions SET position=? WHERE id=?').run(nb.position, id);
    db.prepare('UPDATE bank_questions SET position=? WHERE id=?').run(cur.position, nb.id);
  })();
  return true;
}

export function deleteQuestion(db: Db, id: string): { found: boolean; media: string | null } {
  const q = db.prepare('SELECT media FROM bank_questions WHERE id=?').get(id) as { media: string | null } | undefined;
  if (!q) return { found: false, media: null };
  db.prepare('DELETE FROM bank_questions WHERE id=?').run(id);
  return { found: true, media: q.media ?? null };
}

export function allCategoriesForExport(db: Db): Array<{ id: string; name: string; position: number }> {
  return db.prepare('SELECT id, name, position FROM bank_categories ORDER BY position ASC').all() as Array<{ id: string; name: string; position: number }>;
}

export function allQuestionsForExport(db: Db): BankQuestion[] {
  return (db.prepare('SELECT * FROM bank_questions ORDER BY category_id, position ASC').all() as any[]).map(r => ({
    id: r.id, categoryId: r.category_id, type: r.type, prompt: r.prompt, answer: r.answer, media: r.media ?? null, position: r.position,
  }));
}
