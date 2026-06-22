import { describe, it, expect } from 'vitest';
import { validateBuzz, computeBlock, rankQueue } from './buzzer.js';

describe('validateBuzz', () => {
  it('реакция меньше порога — фальстарт', () => {
    expect(validateBuzz(80, 100)).toBe('falsestart');
  });
  it('нажатие до GO (отрицательная реакция) — фальстарт', () => {
    expect(validateBuzz(-30, 100)).toBe('falsestart');
  });
  it('нормальная реакция — valid', () => {
    expect(validateBuzz(180, 100)).toBe('valid');
  });
});

describe('computeBlock', () => {
  it('первый фальстарт — база без множителя', () => {
    expect(computeBlock(0, 500, 700, () => 0)).toBe(500);
    expect(computeBlock(0, 500, 700, () => 1)).toBe(700);
  });
  it('второй фальстарт — ×2', () => {
    expect(computeBlock(1, 500, 700, () => 0)).toBe(1000);
  });
  it('третий — ×4', () => {
    expect(computeBlock(2, 500, 700, () => 0)).toBe(2000);
  });
});

describe('rankQueue', () => {
  it('дедуп по команде (минимум) и сортировка', () => {
    const q = rankQueue([
      { teamId: 'a', reaction: 300 },
      { teamId: 'b', reaction: 180 },
      { teamId: 'a', reaction: 150 },
    ]);
    expect(q).toEqual([{ teamId: 'a', reaction: 150 }, { teamId: 'b', reaction: 180 }]);
  });
});
