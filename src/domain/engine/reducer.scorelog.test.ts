import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';
import type { GameState } from '../types.js';

let n = 0; const id = () => `sl${n++}`;

/** Игра с двумя командами и игроками; вопрос q1 (value 100) открыт и идёт ANSWERING (a первый). */
function answering(): GameState {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 30 }, id));
  for (const t of ['a', 'b']) s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: t, name: t.toUpperCase() }, id));
  for (const t of ['a', 'b']) s = applyEvent(s, makeEvent('PLAYER_JOINED', { playerId: `pl-${t}`, clientToken: `tok-${t}`, firstName: t, lastName: t, teamId: t }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('QUESTION_REVEALED', {}, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 10 }, id));
  s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 20 }, id)); // ANSWERING, a первый
  return s;
}

describe('reducer — roundScoreLog (история очков раунда)', () => {
  it('пустой при старте', () => {
    expect(initialState().roundScoreLog).toEqual([]);
  });

  it('верный ответ → запись judge со знаком + и correct=true', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: true, value: 100 }, id));
    expect(s.roundScoreLog).toEqual([{ teamId: 'a', delta: 100, kind: 'judge', correct: true }]);
  });

  it('неверный ответ → запись judge со штрафом и correct=false (и для следующей попытки)', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id)); // ход к b
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'b', correct: true, value: 100 }, id));
    expect(s.roundScoreLog).toEqual([
      { teamId: 'a', delta: -100, kind: 'judge', correct: false },
      { teamId: 'b', delta: 100, kind: 'judge', correct: true },
    ]);
  });

  it('таймаут отвечающего → запись judge со штрафом (через nextAttempt)', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_TIMED_OUT', { teamId: 'a' }, id));
    expect(s.roundScoreLog).toEqual([{ teamId: 'a', delta: -100, kind: 'judge', correct: false }]);
  });

  it('ручная правка очков → запись kind=adjust', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('SCORE_ADJUSTED', { teamId: 'b', delta: -50 }, id));
    expect(s.roundScoreLog).toEqual([{ teamId: 'b', delta: -50, kind: 'adjust' }]);
  });

  it('ROUND_RESET очищает лог, ROUND_STARTED тоже', () => {
    let s = answering();
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: true, value: 100 }, id));
    expect(s.roundScoreLog.length).toBe(1);
    s = applyEvent(s, makeEvent('ROUND_RESET', {}, id));
    expect(s.roundScoreLog).toEqual([]);
    s = applyEvent(s, makeEvent('SCORE_ADJUSTED', { teamId: 'a', delta: 10 }, id));
    expect(s.roundScoreLog.length).toBe(1);
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 1, pickingTeamId: 'a' }, id));
    expect(s.roundScoreLog).toEqual([]);
  });
});
