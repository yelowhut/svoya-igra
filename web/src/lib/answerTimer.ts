import { readable, derived } from 'svelte/store';
import { gameStore } from './store.js';

interface TimerFields { answerDeadline: number | null; answerPausedRemainingMs: number | null; serverNow: number; }

export function computeBase(s: TimerFields | null): { baseMs: number; paused: boolean } | null {
  if (!s) return null;
  if (s.answerPausedRemainingMs != null) return { baseMs: s.answerPausedRemainingMs, paused: true };
  if (s.answerDeadline != null) return { baseMs: s.answerDeadline - s.serverNow, paused: false };
  return null;
}
export function tickRemaining(baseMs: number, paused: boolean, elapsedMs: number): number {
  return paused ? baseMs : Math.max(0, baseMs - elapsedMs);
}
export const isLow = (ms: number): boolean => ms <= 10000;
export const displaySeconds = (ms: number): number => Math.ceil(ms / 1000);

// ── ticking-стор для компонентов ──
let base: { baseMs: number; paused: boolean } | null = null;
let startedAt = 0;
gameStore.subscribe((s: any) => {
  base = computeBase(s);
  startedAt = performance.now();
});
const tick = readable(0, (set) => {
  const update = () => set(performance.now());
  const i = setInterval(update, 250);
  return () => clearInterval(i);
});
export const answerRemainingMs = derived(tick, () =>
  base == null ? null : tickRemaining(base.baseMs, base.paused, performance.now() - startedAt));
export const answerSecondsLeft = derived(answerRemainingMs, (ms) => ms == null ? null : displaySeconds(ms));
export const answerLow = derived(answerRemainingMs, (ms) => ms != null && isLow(ms));
