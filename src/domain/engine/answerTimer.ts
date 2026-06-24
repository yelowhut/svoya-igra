import type { GameState } from '../types.js';

export type TimerDecision =
  | { kind: 'start' }
  | { kind: 'timeout'; teamId: string }
  | { kind: 'arm'; delayMs: number }
  | { kind: 'clear' }
  | { kind: 'noop' };

/** Решение по таймеру для текущего состояния. Чистая: без Date.now/setTimeout. */
export function answerTimerDecision(s: GameState, now: number): TimerDecision {
  if (s.phase !== 'ANSWERING') return { kind: 'clear' };
  if (s.answerPausedRemainingMs != null) return { kind: 'clear' };
  if (s.answerDeadline == null) return { kind: 'start' };
  if (s.answerDeadline <= now) {
    const teamId = s.buzzQueue[s.answeringIndex]?.teamId;
    return teamId == null ? { kind: 'noop' } : { kind: 'timeout', teamId };
  }
  return { kind: 'arm', delayMs: s.answerDeadline - now };
}
