import { writable } from 'svelte/store';
export const gameStore = writable<any>(null);
export const blockedUntil = writable<number>(0);
export const goReceivedAt = writable<number>(0);
