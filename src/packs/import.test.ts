import { describe, it, expect, beforeEach } from 'vitest';
import AdmZip from 'adm-zip';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { importPackZip } from './import.js';

const TMP = join(process.cwd(), 'data', 'test-media');
let n = 0; const id = () => `id${n++}`;

function buildZip(withMedia: boolean): Buffer {
  const zip = new AdmZip();
  const game = {
    title: 'Z', rounds: [{ name: 'R', categories: [{ name: 'C', questions: [
      { type: 'image', prompt: 'p', media: 'media/a.jpg', answer: 'x', value: 100, special: 'none' },
    ]}]}],
  };
  zip.addFile('game.json', Buffer.from(JSON.stringify(game), 'utf8'));
  if (withMedia) zip.addFile('media/a.jpg', Buffer.from([1, 2, 3]));
  return zip.toBuffer();
}

describe('importPackZip', () => {
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); n = 0; });

  it('импортирует пак и распаковывает медиа', () => {
    const pack = importPackZip(buildZip(true), TMP, id);
    expect(pack.rounds[0].categories[0].questions[0].media).toBe('media/a.jpg');
    expect(existsSync(join(TMP, pack.id, 'media', 'a.jpg'))).toBe(true);
  });

  it('кидает если media-файл из вопроса отсутствует в архиве', () => {
    expect(() => importPackZip(buildZip(false), TMP, id)).toThrow(/media\/a\.jpg/);
  });
});
