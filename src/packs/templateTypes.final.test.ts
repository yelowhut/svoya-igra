import { describe, it, expect } from 'vitest';
import { makeFinalRound, isFinalRound } from './templateTypes.js';

describe('makeFinalRound', () => {
  it('makeFinalRound создаёт финал-раунд с 2 пустыми темами', () => {
    let n = 0; const r = makeFinalRound(() => `id${n++}`);
    expect(r.type).toBe('final');
    expect(r.themes).toHaveLength(2);
    expect(r.themes[0].questionId).toBeNull();
    expect(isFinalRound(r)).toBe(true);
  });

  it('isFinalRound возвращает false для normal-раунда', () => {
    const normal = { id: 'r1', name: 'Раунд 1', columns: [], rows: [] };
    expect(isFinalRound(normal)).toBe(false);
  });
});
