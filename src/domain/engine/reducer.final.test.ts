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

  function startedFinal() {
    let s = withTeams([{ id: 'A', score: 300 }, { id: 'B', score: 100 }, { id: 'C', score: 200 }]);
    s = apply(s, makeEvent('FINAL_STARTED', { themeIds: ['t1', 't2', 't3'] }));
    return apply(s, makeEvent('FINAL_ELIMINATION_BEGAN', {}));
  }

  it('FINAL_ELIMINATION_BEGAN → фаза FINAL_ELIMINATION', () => {
    expect(startedFinal().phase).toBe('FINAL_ELIMINATION');
  });

  it('FINAL_THEME_REMOVED убирает тему и продвигает ход по кругу', () => {
    let s = startedFinal();                       // order: B(100),C(200),A(300); turn=0 → B
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't1', byTeamId: 'B' }));
    expect(s.final!.themeIds).toEqual(['t2', 't3']);
    expect(s.final!.eliminationTurnIndex).toBe(1); // теперь C
  });

  it('после удаления до одной темы → FINAL_BETTING', () => {
    let s = startedFinal();
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't1', byTeamId: 'B' }));
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't2', byTeamId: 'C' }));
    expect(s.final!.themeIds).toEqual(['t3']);
    expect(s.phase).toBe('FINAL_BETTING');
  });

  function betting() {
    let s = startedFinal();
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't1', byTeamId: 'B' }));
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't2', byTeamId: 'C' }));
    return s; // FINAL_BETTING, участники B,C,A
  }

  it('FINAL_BET_PLACED копит ставки, не меняя фазу пока не все', () => {
    let s = betting();
    s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId: 'B', amount: 50 }));
    expect(s.final!.bets.B).toBe(50);
    expect(s.phase).toBe('FINAL_BETTING');
  });

  it('когда все участники поставили → FINAL_QUESTION', () => {
    let s = betting();
    for (const [tid, amt] of [['B', 50], ['C', 200], ['A', 300]] as const) s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId: tid, amount: amt }));
    expect(s.phase).toBe('FINAL_QUESTION');
    expect(s.final!.answerDeadline).toBeNull(); // таймер стартует в gateway, не тут
  });

  it('ставка клампится 0..score', () => {
    let s = betting();
    s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId: 'B', amount: 9999 }));
    expect(s.final!.bets.B).toBe(100); // score B = 100
  });

  function question() {
    let s = betting();
    for (const [tid, amt] of [['B',50],['C',200],['A',300]] as const) s = apply(s, makeEvent('FINAL_BET_PLACED', { teamId:tid, amount:amt }));
    return s; // FINAL_QUESTION
  }

  it('FINAL_ANSWER_UPDATED копит текст незалоченного', () => {
    let s = question();
    s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' }));
    expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:false });
  });

  it('обновление залоченного игнорируется', () => {
    let s = question();
    s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' }));
    s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:'B' }));
    s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Лермонтов' }));
    expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:true });
  });

  it('когда все залочены → FINAL_REVEAL', () => {
    let s = question();
    for (const tid of ['B','C','A']) { s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:tid, text:'x' })); s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:tid })); }
    expect(s.phase).toBe('FINAL_REVEAL');
  });
});
