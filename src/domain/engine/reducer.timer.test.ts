import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;

function answering() {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 30 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
  return s; // ANSWERING, idx 0, отвечает a
}

describe('reducer — таймер-поля', () => {
  it('GAME_CREATED пишет answerTimerSec', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 60 }, id));
    expect(s.answerTimerSec).toBe(60);
  });

  it('GAME_CREATED без answerTimerSec → дефолт 45 (защита реплея)', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 } as any, id));
    expect(s.answerTimerSec).toBe(45);
  });

  it('ANSWER_TIMER_STARTED ставит дедлайн и сбрасывает паузу', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 5000 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 123456 }, id));
    expect(s.answerDeadline).toBe(123456);
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('ANSWER_TIMER_PAUSED замораживает остаток и гасит дедлайн', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 7000 }, id));
    expect(s.answerPausedRemainingMs).toBe(7000);
    expect(s.answerDeadline).toBeNull();
  });

  it('ANSWER_TIMER_RESUMED ставит дедлайн и снимает паузу', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 7000 }, id));
    s = applyEvent(s, makeEvent('ANSWER_TIMER_RESUMED', { deadline: 222 }, id));
    expect(s.answerDeadline).toBe(222);
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('QUESTION_CLOSED обнуляет таймер-поля', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.answerDeadline).toBeNull();
    expect(s.answerPausedRemainingMs).toBeNull();
  });

  it('верный ответ обнуляет таймер-поля', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_STARTED', { deadline: 99999 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: true, value: 100 }, id));
    expect(s.answerDeadline).toBeNull();
  });

  it('PAUSED/RESUMED вне ANSWERING — no-op', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: 5000 }, id));
    expect(s.answerPausedRemainingMs).toBeNull();
  });
});
