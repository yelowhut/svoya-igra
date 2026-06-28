import { describe, it, expect } from 'vitest';
import { validateBuzz, computeBlock, f1Schedule, rankQueue } from './buzzer.js';

describe('validateBuzz', () => {
  it('нажатие до зелёного (отрицательная реакция) — фальстарт', () => {
    expect(validateBuzz(-30)).toBe('falsestart');
  });
  it('любая неотрицательная реакция после зелёного — valid (зелёный случаен, антиципация невозможна)', () => {
    expect(validateBuzz(0)).toBe('valid');
    expect(validateBuzz(20)).toBe('valid');
    expect(validateBuzz(180)).toBe('valid');
  });
});

describe('computeBlock — микроблок 100/200/400→800, потолок 800', () => {
  it('1-й фальстарт: 100–200 мс', () => {
    expect(computeBlock(0, () => 0)).toBe(100);
    expect(computeBlock(0, () => 1)).toBe(200);
  });
  it('2-й фальстарт: 200–400 мс', () => {
    expect(computeBlock(1, () => 0)).toBe(200);
    expect(computeBlock(1, () => 1)).toBe(400);
  });
  it('3-й фальстарт: 400–800 мс', () => {
    expect(computeBlock(2, () => 0)).toBe(400);
    expect(computeBlock(2, () => 1)).toBe(800);
  });
  it('далее не превышает 800 мс', () => {
    expect(computeBlock(9, () => 1)).toBe(800);
    expect(computeBlock(99, () => 1)).toBeLessThanOrEqual(800);
  });
});

describe('f1Schedule', () => {
  it('каждое состояние 1300–2300 мс (общее время ~5–6 с)', () => {
    expect(f1Schedule(() => 0)).toEqual({ greyMs: 1300, redMs: 1300, yellowMs: 1300 });
    expect(f1Schedule(() => 1)).toEqual({ greyMs: 2300, redMs: 2300, yellowMs: 2300 });
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
