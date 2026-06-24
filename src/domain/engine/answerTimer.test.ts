import { describe, it, expect } from 'vitest';
import { initialState } from './state.js';
import { answerTimerDecision } from './answerTimer.js';
import type { GameState } from '../types.js';

function st(p: Partial<GameState>): GameState { return { ...initialState(), ...p }; }

describe('answerTimerDecision', () => {
  it('не ANSWERING → clear', () => {
    expect(answerTimerDecision(st({ phase: 'PICKING' }), 1000).kind).toBe('clear');
  });
  it('ANSWERING + пауза → clear', () => {
    expect(answerTimerDecision(st({ phase: 'ANSWERING', answerPausedRemainingMs: 5000 }), 1000).kind).toBe('clear');
  });
  it('ANSWERING без дедлайна → start', () => {
    expect(answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: null }), 1000).kind).toBe('start');
  });
  it('дедлайн в будущем → arm с delayMs', () => {
    const d = answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: 5000 }), 1000);
    expect(d).toEqual({ kind: 'arm', delayMs: 4000 });
  });
  it('дедлайн истёк + есть отвечающий → timeout с teamId', () => {
    const d = answerTimerDecision(st({
      phase: 'ANSWERING', answerDeadline: 900,
      buzzQueue: [{ teamId: 'a', reaction: 1 }], answeringIndex: 0,
    }), 1000);
    expect(d).toEqual({ kind: 'timeout', teamId: 'a' });
  });
  it('дедлайн истёк, но очередь пуста → noop', () => {
    const d = answerTimerDecision(st({ phase: 'ANSWERING', answerDeadline: 900, buzzQueue: [], answeringIndex: -1 }), 1000);
    expect(d.kind).toBe('noop');
  });
});
