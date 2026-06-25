import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';

describe('initialState финал-поля', () => {
  it('finalAnswerTimerSec по умолчанию 60, final = null', () => {
    const s = initialState();
    expect(s.finalAnswerTimerSec).toBe(60);
    expect(s.final).toBeNull();
  });
  it('у команд есть captainPlayerId (через тип) — список пуст по умолчанию', () => {
    expect(initialState().teams).toEqual([]);
  });
});
