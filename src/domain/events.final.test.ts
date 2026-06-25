import { describe, it, expect } from 'vitest';
import { makeEvent } from './events.js';

describe('события финала', () => {
  it('makeEvent создаёт FINAL_STARTED с themeIds и id', () => {
    const e = makeEvent('FINAL_STARTED', { themeIds: ['t1', 't2'] });
    expect(e.type).toBe('FINAL_STARTED');
    expect(e.payload.themeIds).toEqual(['t1', 't2']);
    expect(e.id).toBeTruthy();
  });
  it('GAME_CREATED несёт finalAnswerTimerSec', () => {
    const e = makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 60 });
    expect(e.payload.finalAnswerTimerSec).toBe(60);
  });
});
