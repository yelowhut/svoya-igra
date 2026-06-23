import { describe, it, expect } from 'vitest';
import { openDb } from '../persistence/db.js';
import { createCategory, createQuestion, updateQuestion, listCategories, listQuestions } from '../persistence/bankRepo.js';
import { saveBankMedia } from '../http/bankMedia.js';
import { exportBank, importBank } from './bankZip.js';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'data/test-bankzip-src';
const DST = 'data/test-bankzip-dst';

describe('bankZip', () => {
  it('round-trip: export → import в чистую БД сохраняет данные и медиа', () => {
    rmSync(SRC, { recursive: true, force: true });
    rmSync(DST, { recursive: true, force: true });
    const src = openDb(':memory:');
    const cat = createCategory(src, 'Кино');
    const q1 = createQuestion(src, cat.id)!;
    updateQuestion(src, q1.id, { type: 'image', prompt: 'Кто?', answer: 'X', media: saveBankMedia(SRC, `${q1.id}-a.png`, Buffer.from([1, 2, 3])) });
    const q2 = createQuestion(src, cat.id)!;
    updateQuestion(src, q2.id, { prompt: 'Год?', answer: '2001' });

    const buf = exportBank(src, SRC);

    const dst = openDb(':memory:');
    const res = importBank(dst, DST, buf);
    expect(res).toEqual({ categories: 1, questions: 2 });
    expect(listCategories(dst).map(c => ({ id: c.id, name: c.name }))).toEqual([{ id: cat.id, name: 'Кино' }]);
    const qs = listQuestions(dst, cat.id);
    expect(qs.map(q => q.id)).toEqual([q1.id, q2.id]);
    expect(qs[0]).toMatchObject({ type: 'image', prompt: 'Кто?', answer: 'X', media: `bank/media/${q1.id}-a.png` });
    expect(existsSync(join(DST, 'bank', 'media', `${q1.id}-a.png`))).toBe(true);

    rmSync(SRC, { recursive: true, force: true });
    rmSync(DST, { recursive: true, force: true });
  });

  it('импорт идемпотентен и сливает по UID (обновляет)', () => {
    const src = openDb(':memory:');
    const cat = createCategory(src, 'Кино');
    const q = createQuestion(src, cat.id)!;
    updateQuestion(src, q.id, { prompt: 'V1', answer: 'A' });
    const buf1 = exportBank(src, 'data/test-bankzip-noop');

    const dst = openDb(':memory:');
    importBank(dst, 'data/test-bankzip-noop', buf1);
    importBank(dst, 'data/test-bankzip-noop', buf1); // повтор — без дублей
    expect(listCategories(dst)).toHaveLength(1);
    expect(listQuestions(dst, cat.id)).toHaveLength(1);

    // меняем в источнике и переэкспортируем → импорт обновляет тот же UID
    updateQuestion(src, q.id, { prompt: 'V2' });
    importBank(dst, 'data/test-bankzip-noop', exportBank(src, 'data/test-bankzip-noop'));
    expect(listQuestions(dst, cat.id)[0].prompt).toBe('V2');
    expect(listQuestions(dst, cat.id)).toHaveLength(1);
  });
});
