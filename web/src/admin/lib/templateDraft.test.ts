import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createDraft } from './templateDraft.js';
import type { GameTemplate } from './templateTypes.js';

const tpl: GameTemplate = { id: 't', title: 'Игра', rounds: [] };

describe('templateDraft', () => {
  it('flush сохраняет немедленно и ставит saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const d = createDraft('t', tpl, save, 400);
    d.touch();
    await d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(get(d.status)).toBe('saved');
  });
  it('debounced touch вызывает save один раз', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const d = createDraft('t', tpl, save, 400);
    d.touch(); d.touch(); d.touch();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
