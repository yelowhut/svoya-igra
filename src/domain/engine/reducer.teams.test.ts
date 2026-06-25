import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { applyEvent } from './reducer.js';
import { makeEvent } from '../events.js';

let n = 0;
const id = () => `id${n++}`;

function buildBaseState() {
  let s = initialState();
  s = applyEvent(s, makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 't1', name: 'Львы' }, id));
  s = applyEvent(s, makeEvent('TEAM_CREATED', { teamId: 't2', name: 'Тигры' }, id));
  s = applyEvent(s, makeEvent('PLAYER_JOINED', {
    playerId: 'pl1', clientToken: 'tok1', firstName: 'Иван', lastName: 'Петров', teamId: 't1',
  }, id));
  return s;
}

describe('reducer — команды', () => {
  it('TEAM_RENAMED изменяет имя команды', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('TEAM_RENAMED', { teamId: 't1', name: 'Орлы' }, id));
    expect(s1.teams.find(t => t.id === 't1')?.name).toBe('Орлы');
    expect(s1.teams.find(t => t.id === 't2')?.name).toBe('Тигры');
  });

  it('TEAM_RENAMED — no-op если команда не найдена', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('TEAM_RENAMED', { teamId: 'unknown', name: 'X' }, id));
    expect(s1.teams).toHaveLength(2);
  });

  it('PLAYER_MOVED изменяет teamId игрока', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('PLAYER_MOVED', { playerId: 'pl1', teamId: 't2' }, id));
    expect(s1.players.find(p => p.id === 'pl1')?.teamId).toBe('t2');
  });

  it('PLAYER_MOVED — no-op если игрок не найден', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('PLAYER_MOVED', { playerId: 'unknown', teamId: 't2' }, id));
    expect(s1.players).toHaveLength(1);
    expect(s1.players[0].teamId).toBe('t1');
  });

  it('TEAM_DELETED удаляет команду', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('TEAM_DELETED', { teamId: 't1' }, id));
    expect(s1.teams).toHaveLength(1);
    expect(s1.teams[0].id).toBe('t2');
  });

  it('TEAM_DELETED — no-op если команда не найдена', () => {
    const s0 = buildBaseState();
    const s1 = applyEvent(s0, makeEvent('TEAM_DELETED', { teamId: 'unknown' }, id));
    expect(s1.teams).toHaveLength(2);
  });

  it('applyEvent не мутирует входное состояние', () => {
    const s0 = buildBaseState();
    const teamsBefore = JSON.stringify(s0.teams);
    applyEvent(s0, makeEvent('TEAM_RENAMED', { teamId: 't1', name: 'Орлы' }, id));
    expect(JSON.stringify(s0.teams)).toBe(teamsBefore);
  });
});
