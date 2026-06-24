import { describe, it, expect } from 'vitest';
import { computeBase, tickRemaining, isLow, displaySeconds } from './answerTimer.js';

describe('answerTimer helpers', () => {
  it('computeBase: нет таймера → null', () => {
    expect(computeBase({ answerDeadline: null, answerPausedRemainingMs: null, serverNow: 0 })).toBeNull();
  });
  it('computeBase: пауза → baseMs = остаток, paused=true', () => {
    expect(computeBase({ answerDeadline: null, answerPausedRemainingMs: 7000, serverNow: 100 }))
      .toEqual({ baseMs: 7000, paused: true });
  });
  it('computeBase: идёт → baseMs = deadline − serverNow', () => {
    expect(computeBase({ answerDeadline: 5000, answerPausedRemainingMs: null, serverNow: 1000 }))
      .toEqual({ baseMs: 4000, paused: false });
  });
  it('tickRemaining: идёт — вычитает elapsed, не ниже 0', () => {
    expect(tickRemaining(4000, false, 1500)).toBe(2500);
    expect(tickRemaining(1000, false, 5000)).toBe(0);
  });
  it('tickRemaining: пауза — статично', () => {
    expect(tickRemaining(4000, true, 9999)).toBe(4000);
  });
  it('isLow: ≤10000 мс', () => {
    expect(isLow(10000)).toBe(true);
    expect(isLow(10001)).toBe(false);
  });
  it('displaySeconds: округление вверх', () => {
    expect(displaySeconds(4001)).toBe(5);
    expect(displaySeconds(0)).toBe(0);
  });
});
