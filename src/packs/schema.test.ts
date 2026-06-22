import { describe, it, expect } from 'vitest';
import { parseGameJson } from './schema.js';

let n = 0; const id = () => `id${n++}`;
const valid = {
  title: 'Демо',
  rounds: [{
    name: 'Раунд 1',
    categories: [{
      name: 'История',
      questions: [
        { type: 'text', prompt: 'Год?', answer: '1799', value: 100, special: 'none' },
        { type: 'image', prompt: 'Кто?', media: 'media/a.jpg', answer: 'X', value: 200, special: 'cat' },
      ],
    }],
  }],
};

describe('parseGameJson', () => {
  it('парсит валидный пак и проставляет id', () => {
    n = 0;
    const pack = parseGameJson(valid, id);
    expect(pack.title).toBe('Демо');
    expect(pack.rounds[0].categories[0].questions[0].id).toBeDefined();
    expect(pack.rounds[0].categories[0].questions[1].special).toBe('cat');
  });

  it('кидает при отрицательной стоимости', () => {
    const bad = structuredClone(valid);
    bad.rounds[0].categories[0].questions[0].value = -5;
    expect(() => parseGameJson(bad, id)).toThrow();
  });

  it('кидает когда у image нет media', () => {
    const bad = structuredClone(valid);
    delete (bad.rounds[0].categories[0].questions[1] as any).media;
    expect(() => parseGameJson(bad, id)).toThrow();
  });
});
