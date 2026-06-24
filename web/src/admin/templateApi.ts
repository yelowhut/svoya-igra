import type { GameTemplate } from './lib/templateTypes.js';

async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const body = await r.json().catch(() => undefined) as { error?: string; problems?: unknown } | undefined;
    const err = new Error(body?.error ?? `HTTP ${r.status}`) as Error & { problems?: unknown };
    err.problems = body?.problems;
    throw err;
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export const listTemplates = (): Promise<{ id: string; title: string; updatedAt: number }[]> =>
  fetch('/api/game-templates').then(jsonOf);
export const createTemplate = (template?: '5x5'): Promise<{ id: string }> =>
  fetch('/api/game-templates', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ template }) }).then(jsonOf);
export const getTemplate = (id: string): Promise<GameTemplate> =>
  fetch(`/api/game-templates/${id}`).then(jsonOf);
export const saveTemplate = (id: string, doc: GameTemplate): Promise<unknown> =>
  fetch(`/api/game-templates/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(doc) }).then(jsonOf);
export const deleteTemplate = (id: string): Promise<unknown> =>
  fetch(`/api/game-templates/${id}`, { method: 'DELETE' }).then(jsonOf);
export const preflight = (id: string): Promise<{ published: boolean; referencingGames: number }> =>
  fetch(`/api/game-templates/${id}/publish/preflight`).then(jsonOf);
export const publish = (id: string, mode: 'new' | 'overwrite'): Promise<{ packId: string }> =>
  fetch(`/api/game-templates/${id}/publish`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ mode }) }).then(jsonOf);
export const unpublish = (id: string): Promise<unknown> =>
  fetch(`/api/game-templates/${id}/unpublish`, { method: 'POST', headers: jsonHeaders }).then(jsonOf);
export const createGame = (packId: string, title: string, teamCount: number): Promise<{ gameId: string }> =>
  fetch('/api/games', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ packId, title, teamCount }) }).then(jsonOf);

// Re-export types from templateTypes
export type { GameTemplate, Problem } from './lib/templateTypes.js';
