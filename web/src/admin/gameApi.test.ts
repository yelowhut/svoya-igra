import { describe, it, expect, vi, afterEach } from 'vitest';
import { listPacks, activateGame, createGame } from './gameApi.js';

afterEach(() => vi.restoreAllMocks());

describe('gameApi', () => {
  it('listPacks парсит список', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ id: 'p1', title: 'T', rounds: 2 }] })) as unknown as typeof fetch);
    expect(await listPacks()).toEqual([{ id: 'p1', title: 'T', rounds: 2 }]);
  });

  it('activateGame дёргает POST .../activate', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ gameId: 'g1' }) }));
    vi.stubGlobal('fetch', f as unknown as typeof fetch);
    expect(await activateGame('g1')).toEqual({ gameId: 'g1' });
    expect(f).toHaveBeenCalledWith('/api/games/g1/activate', { method: 'POST' });
  });

  it('createGame шлёт packId/title/teamCount', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ gameId: 'g9' }) }));
    vi.stubGlobal('fetch', f as unknown as typeof fetch);
    const r = await createGame('p1', 'Квиз', 4, 60, 60);
    expect(r).toEqual({ gameId: 'g9' });
    expect(f).toHaveBeenCalledWith('/api/games', expect.objectContaining({ method: 'POST' }));
  });

  it('createGame кладёт answerTimerSec в тело', async () => {
    const calls: any[] = [];
    globalThis.fetch = ((url: string, init: any) => { calls.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ gameId: 'g' }) }); }) as any;
    await createGame('p', 'T', 3, 60, 90);
    const body = JSON.parse(calls[0].init.body);
    expect(body.answerTimerSec).toBe(60);
    expect(body.finalAnswerTimerSec).toBe(90);
  });
});
