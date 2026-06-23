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
    const r = await createGame('p1', 'Квиз', 4);
    expect(r).toEqual({ gameId: 'g9' });
    expect(f).toHaveBeenCalledWith('/api/games', expect.objectContaining({ method: 'POST' }));
  });
});
