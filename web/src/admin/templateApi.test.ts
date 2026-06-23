import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from './templateApi.js';

afterEach(() => vi.restoreAllMocks());

describe('templateApi', () => {
  it('createGame шлёт POST /api/games с телом', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g1' }), { status: 200 }));
    const r = await api.createGame('pack1', 'Игра', 3);
    expect(r).toEqual({ gameId: 'g1' });
    expect(spy.mock.calls[0][0]).toBe('/api/games');
  });
});
