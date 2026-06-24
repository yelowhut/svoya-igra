import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0;
const id = () => `id${n++}`;

describe('reducer — лобби', () => {
  it('GAME_CREATED заполняет мету', () => {
    const s = applyEvent(initialState(), makeEvent('GAME_CREATED',
      { gameId: 'g1', packId: 'p1', title: 'Тест', teamCount: 2, answerTimerSec: 45 }, id));
    expect(s.gameId).toBe('g1');
    expect(s.teamCount).toBe(2);
    expect(s.phase).toBe('LOBBY');
  });

  it('TEAM_CREATED и PLAYER_JOINED добавляют сущности', () => {
    let s = initialState();
    s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2, answerTimerSec: 45 }, id));
    s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 't1', name: 'Львы' }, id));
    s = applyEvent(s, makeEvent('PLAYER_JOINED', { playerId: 'pl1', clientToken: 'tok', firstName: 'Иван', lastName: 'Петров', teamId: 't1' }, id));
    expect(s.teams).toHaveLength(1);
    expect(s.teams[0].score).toBe(0);
    expect(s.players[0].connected).toBe(true);
  });

  it('не мутирует исходное состояние', () => {
    const s0 = initialState();
    applyEvent(s0, makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 45 }, id));
    expect(s0.gameId).toBe('');
  });
});
