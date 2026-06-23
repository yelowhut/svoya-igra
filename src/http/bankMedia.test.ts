import { describe, it, expect } from 'vitest';
import { isAllowedMime, sanitizeBankFilename, saveBankMedia, gcMedia } from './bankMedia.js';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('bankMedia', () => {
  it('isAllowedMime', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('audio/mpeg')).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(false);
    expect(isAllowedMime('application/zip')).toBe(false);
  });

  it('sanitizeBankFilename: префикс UID, безопасные символы, расширение', () => {
    expect(sanitizeBankFilename('Q1', 'Мой Файл!!.PNG')).toBe('Q1-.png'.replace('-.', '-file.')); // кириллица вычищается → base пустой → 'file'
    expect(sanitizeBankFilename('Q1', 'cat_pic.JPG')).toBe('Q1-cat_pic.jpg');
    expect(sanitizeBankFilename('Q1', '../../evil.png')).toBe('Q1-evil.png');
    const long = 'a'.repeat(200) + '.webp';
    const out = sanitizeBankFilename('Q1', long);
    expect(out.startsWith('Q1-' + 'a'.repeat(80) + '.webp')).toBe(true);
  });

  it('gcMedia не удаляет файлы вне bank/media (traversal)', () => {
    const dir = 'data/test-gc-traversal';
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const sentinel = join(dir, 'keep.txt');
    writeFileSync(sentinel, 'x');
    gcMedia(join(dir, 'sub'), ['../keep.txt']); // попытка выйти за пределы
    expect(existsSync(sentinel)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveBankMedia пишет файл и возвращает bank/media-путь', () => {
    const dir = 'data/test-savemedia';
    rmSync(dir, { recursive: true, force: true });
    const path = saveBankMedia(dir, 'Q1-pic.png', Buffer.from([1, 2, 3]));
    expect(path).toBe('bank/media/Q1-pic.png');
    expect(existsSync(join(dir, 'bank', 'media', 'Q1-pic.png'))).toBe(true);
    expect([...readFileSync(join(dir, path))]).toEqual([1, 2, 3]);
    rmSync(dir, { recursive: true, force: true });
  });
});
