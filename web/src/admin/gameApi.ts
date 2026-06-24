async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const body = await r.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error ?? `HTTP ${r.status}`);
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export interface PackSummary { id: string; title: string; rounds: number; }
export interface GameSummary { gameId: string; title: string; phase: string; }

export const listPacks = (): Promise<PackSummary[]> => fetch('/api/packs').then(jsonOf);
export const listGames = (): Promise<GameSummary[]> => fetch('/api/games').then(jsonOf);
export const gameExists = (id: string): Promise<{ exists: boolean }> => fetch(`/api/games/${id}/exists`).then(jsonOf);
export const activateGame = (id: string): Promise<{ gameId: string }> => fetch(`/api/games/${id}/activate`, { method: 'POST' }).then(jsonOf);
export const deactivateGame = (id: string): Promise<{ ok: true }> => fetch(`/api/games/${id}/deactivate`, { method: 'POST' }).then(jsonOf);
export const createGame = (packId: string, title: string, teamCount: number, answerTimerSec: number): Promise<{ gameId: string }> =>
  fetch('/api/games', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ packId, title, teamCount, answerTimerSec }) }).then(jsonOf);
