import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function withTeams(): ReturnType<typeof initialState> {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  return s;
}

describe('reducer — поток игры', () => {
  it('ROUND_STARTED ставит фазу PICKING и picking-команду', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('GAME_STARTED', {}, id));
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'b' }, id));
    expect(s.phase).toBe('PICKING');
    expect(s.roundIndex).toBe(0);
    expect(s.pickingTeamId).toBe('b');
  });

  it('QUESTION_SELECTED фиксирует вопрос и стоимость, фаза QUESTION', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 200, special: 'none' }, id));
    expect(s.phase).toBe('QUESTION');
    expect(s.currentQuestionId).toBe('q1');
    expect(s.currentValue).toBe(200);
  });

  it('QUESTION_SELECTED с special auction создает auction объект', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q2', value: 300, special: 'auction' }, id));
    expect(s.phase).toBe('QUESTION');
    expect(s.currentQuestionId).toBe('q2');
    expect(s.currentValue).toBe(300);
    expect(s.auction).not.toBeNull();
    expect(s.auction?.baseValue).toBe(300);
    expect(s.auction?.highestBid).toBe(300);
    expect(s.auction?.leaderTeamId).toBeNull();
    expect(s.auction?.passedTeamIds).toEqual([]);
  });

  it('BUZZER_ARMED и BUZZER_OPENED меняют фазу и чистят очередь', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
    s = applyEvent(s, makeEvent('BUZZER_ARMED', {}, id));
    expect(s.phase).toBe('BUZZER_ARMED');
    s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
    expect(s.phase).toBe('BUZZER_OPEN');
    expect(s.buzzQueue).toEqual([]);
    expect(s.answeringIndex).toBe(-1);
  });

  it('QUESTION_SELECTED чистит очередь реакций прошлого вопроса (п.1)', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    // имитируем «оставшуюся» очередь от прошлой карточки
    s = { ...s, buzzQueue: [{ teamId: 'a', reaction: 120 }], answeringIndex: 0 };
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
    expect(s.buzzQueue).toEqual([]);
    expect(s.answeringIndex).toBe(-1);
  });

  it('QUESTION_CLOSED НЕ чистит очередь реакций — она видна в PICKING до новой карточки (п.9)', () => {
    let s = withTeams();
    s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
    s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
    s = { ...s, phase: 'JUDGED', buzzQueue: [{ teamId: 'a', reaction: 90 }, { teamId: 'b', reaction: 150 }], answeringIndex: 0 };
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.phase).toBe('PICKING');
    expect(s.buzzQueue.map(e => e.teamId)).toEqual(['a', 'b']);
  });

  it('ROUND_RESET всё ещё чистит очередь реакций (п.9 — регресс)', () => {
    let s = withTeams();
    s = { ...s, buzzQueue: [{ teamId: 'a', reaction: 90 }], answeringIndex: 0 };
    s = applyEvent(s, makeEvent('ROUND_RESET', {}, id));
    expect(s.buzzQueue).toEqual([]);
    expect(s.answeringIndex).toBe(-1);
  });
});
