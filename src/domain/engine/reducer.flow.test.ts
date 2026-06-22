import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function withTeams(): ReturnType<typeof initialState> {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
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
});
