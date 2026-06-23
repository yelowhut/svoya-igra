import { writable, get, type Writable } from 'svelte/store';
import type { GameTemplate } from './templateTypes.js';

export function createDraft(
  id: string,
  initial: GameTemplate,
  save: (doc: GameTemplate) => Promise<unknown>,
  delayMs = 400,
) {
  const doc: Writable<GameTemplate> = writable(initial);
  const status = writable<'idle' | 'saving' | 'saved'>('idle');
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function persist() {
    status.set('saving');
    try { await save(get(doc)); status.set('saved'); }
    catch { status.set('idle'); }
  }
  function touch() {
    status.set('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, delayMs);
  }
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    await persist();
  }
  return { doc, status, touch, flush };
}
