import { describe, it, expect } from 'vitest';
import { finalTimerDecision } from './finalTimer.js';

describe('finalTimerDecision', () => {
  it('вне FINAL_QUESTION → clear', () => {
    const s: any = { phase: 'FINAL_BETTING', final: { answerDeadline: null, answerPausedRemainingMs: null } };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'clear' });
  });

  it('FINAL_QUESTION без дедлайна → start', () => {
    const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: null, answerPausedRemainingMs: null } };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'start' });
  });

  it('дедлайн истёк → timeout', () => {
    const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: 500, answerPausedRemainingMs: null } };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'timeout' });
  });

  it('пауза → clear', () => {
    const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: 5000, answerPausedRemainingMs: 3000 } };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'clear' });
  });

  it('дедлайн в будущем → arm с правильным delayMs', () => {
    const s: any = { phase: 'FINAL_QUESTION', final: { answerDeadline: 5000, answerPausedRemainingMs: null } };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'arm', delayMs: 4000 });
  });

  it('без final → clear', () => {
    const s: any = { phase: 'FINAL_QUESTION', final: null };
    expect(finalTimerDecision(s, 1000)).toEqual({ kind: 'clear' });
  });
});
