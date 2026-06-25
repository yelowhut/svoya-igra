import type { GameState } from '../types.js';

/** Локальный тип решения для финального таймера.
 *  В отличие от TimerDecision из answerTimer.ts, вариант timeout не несёт teamId —
 *  в финале нет «отвечающей команды», все участники отвечают одновременно.
 */
export type FinalTimerDecision =
  | { kind: 'start' }
  | { kind: 'timeout' }
  | { kind: 'arm'; delayMs: number }
  | { kind: 'clear' };

/** Решение по таймеру финального раунда. Чистая функция: без Date.now/setTimeout. */
export function finalTimerDecision(s: GameState, now: number): FinalTimerDecision {
  if (s.phase !== 'FINAL_QUESTION' || !s.final) return { kind: 'clear' };
  if (s.final.answerPausedRemainingMs != null) return { kind: 'clear' };
  if (s.final.answerDeadline == null) return { kind: 'start' };
  if (s.final.answerDeadline <= now) return { kind: 'timeout' };
  return { kind: 'arm', delayMs: s.final.answerDeadline - now };
}
