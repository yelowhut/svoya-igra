import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function armed() {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }, id));
  s = applyEvent(s, makeEvent('BUZZER_OPENED', {}, id));
  return s;
}

describe('reducer — buzz и вердикт', () => {
  it('buzz строит очередь по возрастанию reaction, первый buzz → ANSWERING', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 250 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 180 }, id));
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue.map(e => e.teamId)).toEqual(['a', 'b']);
    expect(s.answeringIndex).toBe(0);
  });

  it('дубликат от команды не двоит очередь (хранит минимум)', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 300 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 150 }, id));
    expect(s.buzzQueue).toHaveLength(1);
    expect(s.buzzQueue[0].reaction).toBe(150);
  });

  it('верный ответ: +стоимость, picking переходит к команде', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'b', correct: true, value: 100 }, id));
    expect(s.teams.find(t => t.id === 'b')!.score).toBe(100);
    expect(s.phase).toBe('JUDGED');
    expect(s.pickingTeamId).toBe('b');
  });

  it('неверный: −стоимость и ход к следующей в очереди', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'b', reaction: 200 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
    expect(s.teams.find(t => t.id === 'a')!.score).toBe(-100);
    expect(s.phase).toBe('ANSWERING');
    expect(s.answeringIndex).toBe(1);
  });

  it('неверный последней в очереди → JUDGED, picking не меняется', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }, id));
    s = applyEvent(s, makeEvent('ANSWER_JUDGED', { teamId: 'a', correct: false, value: 100 }, id));
    expect(s.phase).toBe('JUDGED');
    expect(s.pickingTeamId).toBe('a'); // как было из ROUND_STARTED
  });

  it('QUESTION_CLOSED помечает клетку использованной, фаза PICKING', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('QUESTION_CLOSED', {}, id));
    expect(s.usedQuestionIds).toContain('q1');
    expect(s.currentQuestionId).toBeNull();
    expect(s.phase).toBe('PICKING');
  });

  it('SCORE_ADJUSTED меняет счёт вручную', () => {
    let s = armed();
    s = applyEvent(s, makeEvent('SCORE_ADJUSTED', { teamId: 'b', delta: -50 }, id));
    expect(s.teams.find(t => t.id === 'b')!.score).toBe(-50);
  });
});
