import { describe, it, expect } from 'vitest';
import { makeEvent } from './events.js';

describe('makeEvent', () => {
  it('создаёт событие с id и payload', () => {
    const e = makeEvent('GAME_STARTED', {}, () => 'fixed-id');
    expect(e.id).toBe('fixed-id');
    expect(e.type).toBe('GAME_STARTED');
  });

  it('makeEvent строит таймер-события с типизированным payload', () => {
    const started = makeEvent('ANSWER_TIMER_STARTED', { deadline: 1000 }, () => 'x');
    expect(started.payload.deadline).toBe(1000);
    const out = makeEvent('ANSWER_TIMED_OUT', { teamId: 'a' }, () => 'x');
    expect(out.payload.teamId).toBe('a');
    const created = makeEvent('GAME_CREATED',
      { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 60, finalAnswerTimerSec: 60 }, () => 'x');
    expect(created.payload.answerTimerSec).toBe(60);
  });
});
