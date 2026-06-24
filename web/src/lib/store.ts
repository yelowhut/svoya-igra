import { writable } from 'svelte/store';
export const gameStore = writable<any>(null);
export const blockedUntil = writable<number>(0);
// Локальное расписание стартовых огней F1 (performance.now()-времена), вычисляется при goSignal.
export type BuzzSeq = { redAt: number; yellowAt: number; greenAt: number } | null;
export const buzzSeq = writable<BuzzSeq>(null);
export const lastError = writable<string>('');
export const me = writable<{ playerId: string; teamId: string; role: string } | null>(null);
