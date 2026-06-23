import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from './server.js';
import { requireAdmin } from './auth.js';
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate } from '../persistence/templateRepo.js';
import type { GameTemplate } from '../packs/templateTypes.js';

export function findActiveGameIds(deps: ServerDeps, packId: string): string[] {
  const rows = deps.db.prepare("SELECT game_id, payload FROM events WHERE type = 'GAME_CREATED'")
    .all() as Array<{ game_id: string; payload: string }>;
  const ids: string[] = [];
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { packId: string };
    if (payload.packId !== packId) continue;
    if (deps.store.loadState(row.game_id).phase !== 'GAME_END') ids.push(row.game_id);
  }
  return ids;
}

export function registerTemplates(app: FastifyInstance, deps: ServerDeps): void {
  const { db } = deps;
  const guard = { preHandler: requireAdmin };

  app.get('/api/game-templates', guard, async () => listTemplates(db));

  app.post('/api/game-templates', guard, async (req) => {
    const { template } = (req.body ?? {}) as { template?: '5x5' };
    return createTemplate(db, { template: template === '5x5' ? '5x5' : undefined });
  });

  app.get('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getTemplate(db, id);
    if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });
    return doc;
  });

  app.put('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = req.body as GameTemplate;
    if (!saveTemplate(db, id, doc)) return reply.code(404).send({ error: 'шаблон не найден' });
    return { ok: true };
  });

  app.delete('/api/game-templates/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteTemplate(db, id)) return reply.code(404).send({ error: 'шаблон не найден' });
    return { ok: true };
  });

  app.get('/api/game-templates/:id/publish/preflight', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = getTemplate(db, id);
    if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });
    const packId = doc.lastPublishedPackId;
    return {
      published: !!packId,
      referencingGames: packId ? findActiveGameIds(deps, packId).length : 0,
    };
  });
}
