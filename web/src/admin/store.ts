import { writable } from 'svelte/store';

const LS_KEY = 'svoya:host';

function persistentGameId() {
  let initial: string | null = null;
  try { initial = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')?.gameId ?? null; } catch { /* ignore */ }
  const store = writable<string | null>(initial);
  store.subscribe(v => {
    try {
      if (v) localStorage.setItem(LS_KEY, JSON.stringify({ gameId: v }));
      else localStorage.removeItem(LS_KEY);
    } catch { /* ignore */ }
  });
  return store;
}

/** Игра, которой сейчас управляет ведущий (Лобби/Пульт читают её). Переживает F5. */
export const workingGameId = persistentGameId();

/** Зарезервированное «Время на ответ», сек. UI-only в SP3 (логика — отдельный engine-спек). */
export const answerTimerSec = writable<number>(45);
