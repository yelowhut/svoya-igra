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

  it('FINAL_THEME_REMOVED с несуществующим themeId — no-op (themeIds и turnIndex не меняются)', () => {
    let s = startedFinal();                       // order: B(100),C(200),A(300); turn=0 → B
    const before = { themeIds: s.final!.themeIds.slice(), turnIndex: s.final!.eliminationTurnIndex };
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 'no-such-theme', byTeamId: 'B' }));
    expect(s.final!.themeIds).toEqual(before.themeIds);
    expect(s.final!.eliminationTurnIndex).toBe(before.turnIndex);
  });

  it('FINAL_THEME_REMOVED с уже удалённым themeId — no-op (повторный дубль)', () => {
    let s = startedFinal();                       // themes: t1, t2, t3; turn=0 → B
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't1', byTeamId: 'B' })); // удалили t1, turn→1
    const afterFirst = { themeIds: s.final!.themeIds.slice(), turnIndex: s.final!.eliminationTurnIndex };
    s = apply(s, makeEvent('FINAL_THEME_REMOVED', { themeId: 't1', byTeamId: 'B' })); // дубль
    expect(s.final!.themeIds).toEqual(afterFirst.themeIds);
    expect(s.final!.eliminationTurnIndex).toBe(afterFirst.turnIndex);
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

  it('FINAL_TIMED_OUT лочит всех участников (включая без текста) и идёт в FINAL_REVEAL', () => {
    let s = question();
    s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:'B', text:'Пушкин' })); // только B печатал
    s = apply(s, makeEvent('FINAL_TIMED_OUT', {}));
    expect(s.phase).toBe('FINAL_REVEAL');
    expect(s.final!.answers.B).toEqual({ text:'Пушкин', locked:true });
    expect(s.final!.answers.C).toEqual({ text:'', locked:true });
    expect(s.final!.answers.A).toEqual({ text:'', locked:true });
  });

  it('FINAL_TIMER_PAUSED/RESUMED двигают поля', () => {
    let s = question();
    s = apply(s, makeEvent('FINAL_TIMER_STARTED', { deadline: 10000 }));
    expect(s.final!.answerDeadline).toBe(10000);
    s = apply(s, makeEvent('FINAL_TIMER_PAUSED', { remainingMs: 4000 }));
    expect(s.final!.answerPausedRemainingMs).toBe(4000);
    expect(s.final!.answerDeadline).toBeNull();
    s = apply(s, makeEvent('FINAL_TIMER_RESUMED', { deadline: 20000 }));
    expect(s.final!.answerPausedRemainingMs).toBeNull();
    expect(s.final!.answerDeadline).toBe(20000);
  });

  function reveal() {
    let s = question();
    for (const tid of ['B','C','A']) { s = apply(s, makeEvent('FINAL_ANSWER_UPDATED', { teamId:tid, text:'x' })); s = apply(s, makeEvent('FINAL_ANSWER_LOCKED', { teamId:tid })); }
    return s; // FINAL_REVEAL; bets B=50,C=200,A=300
  }

  it('верный ответ прибавляет ставку, revealIndex++', () => {
    let s = reveal();
    const before = s.teams.find(t=>t.id==='B')!.score; // 100
    s = apply(s, makeEvent('FINAL_ANSWER_JUDGED', { teamId:'B', correct:true }));
    expect(s.teams.find(t=>t.id==='B')!.score).toBe(before + 50);
    expect(s.final!.revealIndex).toBe(1);
  });

  it('неверный ответ вычитает ставку', () => {
    let s = reveal();
    const before = s.teams.find(t=>t.id==='C')!.score; // 200
    s = apply(s, makeEvent('FINAL_ANSWER_JUDGED', { teamId:'C', correct:false }));
    expect(s.teams.find(t=>t.id==='C')!.score).toBe(before - 200);
  });

  it('GAME_ENDED из FINAL_REVEAL → GAME_END', () => {
    let s = reveal();
    s = apply(s, makeEvent('GAME_ENDED', {}));
    expect(s.phase).toBe('GAME_END');
  });
});
