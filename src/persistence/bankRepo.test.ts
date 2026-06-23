import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from './db.js';
import {
  createCategory, listCategories, renameCategory, reorderCategories, deleteCategory,
  createQuestion, listQuestions, getQuestion, updateQuestion, reorderQuestions, deleteQuestion,
} from './bankRepo.js';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('bankRepo categories', () => {
  it('create → list с questionCount=0, position по возрастанию', () => {
    const a = createCategory(db, 'Кино');
    const b = createCategory(db, 'Космос');
    const list = listCategories(db);
    expect(list.map(c => c.name)).toEqual(['Кино', 'Космос']);
    expect(list[0]).toMatchObject({ id: a.id, name: 'Кино', position: 1, questionCount: 0 });
    expect(list[1].id).toBe(b.id);
  });

  it('questionCount считает вопросы', () => {
    const a = createCategory(db, 'Кино');
    createQuestion(db, a.id); createQuestion(db, a.id);
    expect(listCategories(db)[0].questionCount).toBe(2);
  });

  it('rename', () => {
    const a = createCategory(db, 'Кино');
    expect(renameCategory(db, a.id, 'Фильмы')).toBe(true);
    expect(listCategories(db)[0].name).toBe('Фильмы');
    expect(renameCategory(db, 'нет', 'X')).toBe(false);
  });

  it('reorder переписывает порядок по списку id', () => {
    const a = createCategory(db, 'A');
    const b = createCategory(db, 'B');
    const c = createCategory(db, 'C');
    reorderCategories(db, [c.id, a.id, b.id]);
    expect(listCategories(db).map(x => x.name)).toEqual(['C', 'A', 'B']);
    expect(listCategories(db).map(x => x.position)).toEqual([1, 2, 3]);
  });

  it('delete каскадно удаляет вопросы и возвращает их media', () => {
    const a = createCategory(db, 'Кино');
    const q1 = createQuestion(db, a.id)!;
    updateQuestion(db, q1.id, { media: 'bank/media/x.png' });
    createQuestion(db, a.id);
    const res = deleteCategory(db, a.id);
    expect(res.found).toBe(true);
    expect(res.mediaPaths).toEqual(['bank/media/x.png']);
    expect(listCategories(db)).toHaveLength(0);
    expect(listQuestions(db, a.id)).toHaveLength(0);
    expect(deleteCategory(db, a.id)).toEqual({ found: false, mediaPaths: [] });
  });
});

describe('bankRepo questions', () => {
  it('create с дефолтами; null если категории нет', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    expect(getQuestion(db, q.id)).toMatchObject({
      id: q.id, categoryId: a.id, type: 'text', prompt: '', answer: '', media: null, position: 1,
    });
    expect(createQuestion(db, 'нет-такой')).toBeNull();
  });

  it('update полей; media в null', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    expect(updateQuestion(db, q.id, { type: 'image', prompt: 'Кто?', answer: 'X', media: 'bank/media/a.jpg' })).toBe(true);
    expect(getQuestion(db, q.id)).toMatchObject({ type: 'image', prompt: 'Кто?', answer: 'X', media: 'bank/media/a.jpg' });
    updateQuestion(db, q.id, { media: null });
    expect(getQuestion(db, q.id)!.media).toBeNull();
    expect(updateQuestion(db, 'нет', { prompt: 'x' })).toBe(false);
  });

  it('reorder вопросов в пределах категории', () => {
    const a = createCategory(db, 'Кино');
    const q1 = createQuestion(db, a.id)!;
    const q2 = createQuestion(db, a.id)!;
    const q3 = createQuestion(db, a.id)!;
    reorderQuestions(db, a.id, [q3.id, q1.id, q2.id]);
    expect(listQuestions(db, a.id).map(q => q.id)).toEqual([q3.id, q1.id, q2.id]);
  });

  it('delete возвращает media', () => {
    const a = createCategory(db, 'Кино');
    const q = createQuestion(db, a.id)!;
    updateQuestion(db, q.id, { media: 'bank/media/a.jpg' });
    expect(deleteQuestion(db, q.id)).toEqual({ found: true, media: 'bank/media/a.jpg' });
    expect(getQuestion(db, q.id)).toBeNull();
    expect(deleteQuestion(db, q.id)).toEqual({ found: false, media: null });
  });
});
