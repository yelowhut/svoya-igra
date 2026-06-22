import { writable } from 'svelte/store';
export const gameStore = writable<any>(null);
export const blockedUntil = writable<number>(0);
export const goReceivedAt = writable<number>(0);
export const lastError = writable<string>('');
export const me = writable<{ playerId: string; teamId: string; role: string } | null>(null);
