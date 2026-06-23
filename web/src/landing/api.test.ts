import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchActiveGame } from './api.js';

afterEach(() => vi.restoreAllMocks());

describe('fetchActiveGame', () => {
  it('возвращает объект игры', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ gameId: 'g1', title: 'Квиз', phase: 'PICKING', teamCount: 6, playerCount: 4, totalRounds: 3, currentRound: 1 }),
    })) as unknown as typeof fetch);
    const g = await fetchActiveGame();
    expect(g?.title).toBe('Квиз');
    expect(g?.currentRound).toBe(1);
  });

  it('возвращает null, когда тело null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => null })) as unknown as typeof fetch);
    expect(await fetchActiveGame()).toBeNull();
  });

  it('возвращает null при не-ок ответе', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch);
    expect(await fetchActiveGame()).toBeNull();
  });
});
