import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0; const id = () => `id${n++}`;
function base(special: 'auction' | 'cat') {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }, id));
  s = applyEvent(s, makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }, id));
  s = applyEvent(s, makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special }, id));
  return s;
}

describe('reducer — спецтипы', () => {
  it('аукцион: ставка повышает лидера, WON → отвечает один на сумму ставки', () => {
    let s = base('auction');
    s = applyEvent(s, makeEvent('AUCTION_BID', { teamId: 'a', amount: 150 }, id));
    s = applyEvent(s, makeEvent('AUCTION_BID', { teamId: 'b', amount: 300 }, id));
    expect(s.auction!.leaderTeamId).toBe('b');
    s = applyEvent(s, makeEvent('AUCTION_WON', { teamId: 'b', amount: 300 }, id));
    expect(s.currentValue).toBe(300);
    expect(s.pickingTeamId).toBe('b');
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue).toEqual([{ teamId: 'b', reaction: 0 }]);
  });

  it('кот в мешке: назначение получателя → отвечает он один', () => {
    let s = base('cat');
    s = applyEvent(s, makeEvent('CAT_ASSIGNED', { toTeamId: 'b' }, id));
    expect(s.assignedTeamId).toBe('b');
    expect(s.phase).toBe('ANSWERING');
    expect(s.buzzQueue).toEqual([{ teamId: 'b', reaction: 0 }]);
  });

  it('конец раунда и игры меняют фазу', () => {
    let s = base('auction');
    s = applyEvent(s, makeEvent('ROUND_ENDED', {}, id));
    expect(s.phase).toBe('ROUND_END');
    s = applyEvent(s, makeEvent('GAME_ENDED', {}, id));
    expect(s.phase).toBe('GAME_END');
  });
});
