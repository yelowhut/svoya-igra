import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate, loadBankView } from './templateRepo.js';
import type { TemplateNormalRound } from '../packs/templateTypes.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('templateRepo', () => {
  it('create 5x5 → get возвращает документ с 1 раундом 5x5', () => {
    const { id } = createTemplate(db, { template: '5x5' });
    const doc = getTemplate(db, id)!;
    expect(doc.id).toBe(id);
    expect((doc.rounds[0] as TemplateNormalRound).columns).toHaveLength(5);
  });
  it('get несуществующего → null', () => {
    expect(getTemplate(db, 'nope')).toBeNull();
  });
  it('save обновляет документ и возвращает true', () => {
    const { id } = createTemplate(db, {});
    const doc = getTemplate(db, id)!;
    doc.title = 'Переименовано';
    expect(saveTemplate(db, id, doc)).toBe(true);
    expect(getTemplate(db, id)!.title).toBe('Переименовано');
  });
  it('save несуществующего → false', () => {
    const { id } = createTemplate(db, {});
    const doc = getTemplate(db, id)!;
    expect(saveTemplate(db, 'nope', doc)).toBe(false);
  });
  it('list отдаёт {id,title,updatedAt}', () => {
    const a = createTemplate(db, {});
    const list = listTemplates(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, title: 'Новая игра' });
    expect(typeof list[0].updatedAt).toBe('number');
  });
  it('delete удаляет', () => {
    const { id } = createTemplate(db, {});
    expect(deleteTemplate(db, id)).toBe(true);
    expect(getTemplate(db, id)).toBeNull();
    expect(deleteTemplate(db, id)).toBe(false);
  });
});

describe('loadBankView', () => {
  it('собирает категории и вопросы в Map по id', () => {
    db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run('c1', 'Кино', 1);
    db.prepare('INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)')
      .run('q1', 'c1', 'image', 'Кадр', 'Ответ', 'bank/media/x.png', 1);
    const view = loadBankView(db);
    expect(view.categories.get('c1')).toEqual({ id: 'c1', name: 'Кино' });
    expect(view.questions.get('q1')).toMatchObject({ categoryId: 'c1', type: 'image', media: 'bank/media/x.png' });
  });
});
