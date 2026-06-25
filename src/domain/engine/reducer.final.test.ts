import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0;
const id = () => `id${n++}`;

function apply(s: ReturnType<typeof initialState>, event: Parameters<typeof applyEvent>[1]) {
  return applyEvent(s, event);
}

/** Строит GameState с командами: GAME_CREATED + TEAM_CREATED * N + SCORE_ADJUSTED при score≠0 */
function withTeams(teams: { id: string; score: number }[]): ReturnType<typeof initialState> {
  let s = initialState();
  s = apply(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: teams.length, answerTimerSec: 45, finalAnswerTimerSec: 60 }, id));
  for (const t of teams) {
    s = apply(s, makeEvent('TEAM_CREATED', { teamId: t.id, name: t.id }, id));
    if (t.score !== 0) {
      s = apply(s, makeEvent('SCORE_ADJUSTED', { teamId: t.id, delta: t.score }, id));
    }
  }
  return s;
}

describe('reducer — финал', () => {
  it('GAME_CREATED сохраняет finalAnswerTimerSec', () => {
    const s = apply(initialState(), makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 90 }));
    expect(s.finalAnswerTimerSec).toBe(90);
  });

  it('CAPTAIN_ASSIGNED проставляет капитана', () => {
    let s = withTeams([{ id: 'A', score: 100 }, { id: 'B', score: 50 }]);
    s = apply(s, makeEvent('CAPTAIN_ASSIGNED', { teamId: 'A', playerId: 'p1' }));
    expect(s.teams.find(t => t.id === 'A')!.captainPlayerId).toBe('p1');
  });

  it('FINAL_STARTED строит eliminationOrder по возрастанию счёта, исключая <=0', () => {
    let s = withTeams([{ id: 'A', score: 300 }, { id: 'B', score: 100 }, { id: 'C', score: 0 }, { id: 'D', score: -50 }]);
    s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1', 't2', 't3'] }));
    expect(s.phase).toBe('FINAL_INTRO');
    expect(s.final).not.toBeNull();
    expect(s.final!.eliminationOrder).toEqual(['B', 'A']); // C,D исключены
    expect(s.final!.themeIds).toEqual(['t1', 't2', 't3']);
    expect(s.final!.eliminationTurnIndex).toBe(0);
  });

  it('равные счета — тай-брейк по порядку команд', () => {
    let s = withTeams([{ id: 'A', score: 100 }, { id: 'B', score: 100 }]);
    s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1', 't2'] }));
    expect(s.final!.eliminationOrder).toEqual(['A', 'B']);
  });
});
