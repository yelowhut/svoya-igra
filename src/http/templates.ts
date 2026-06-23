import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from './server.js';
import { requireAdmin } from './auth.js';
import { createTemplate, getTemplate, listTemplates, saveTemplate, deleteTemplate, loadBankView } from '../persistence/templateRepo.js';
import type { GameTemplate } from '../packs/templateTypes.js';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { validateForPublish } from '../packs/templateValidate.js';
import { flattenTemplate } from '../packs/templateFlatten.js';
import { parseGameJson } from '../packs/schema.js';
import { makeEvent } from '../domain/events.js';
import { clearActiveGameIfMatches } from '../persistence/activeGameRepo.js';

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

  app.post('/api/game-templates/:id/publish', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { mode } = (req.body ?? {}) as { mode?: 'new' | 'overwrite' };
    const doc = getTemplate(db, id);
    if (!doc) return reply.code(404).send({ error: 'шаблон не найден' });

    const bank = loadBankView(db);
    const mediaRoot = resolve(deps.config.mediaDir);
    const mediaExists = (rel: string) => existsSync(join(mediaRoot, rel));
    const { errors } = validateForPublish(doc, bank, mediaExists);
    if (errors.length) return reply.code(400).send({ error: 'есть незаполненные/невалидные поля', problems: errors });

    if (mode === 'overwrite' && !doc.lastPublishedPackId) return reply.code(400).send({ error: 'нет ранее опубликованного пака' });
    const packId = mode === 'overwrite' ? doc.lastPublishedPackId! : crypto.randomUUID();

    const { game, mediaCopies } = flattenTemplate(doc, bank);
    const pack = parseGameJson(game);
    pack.id = packId;
    db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(packId, JSON.stringify(pack));

    for (const { from, to } of mediaCopies) {
      const dest = join(mediaRoot, packId, to);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(mediaRoot, from), dest);
    }

    for (const gameId of findActiveGameIds(deps, packId)) {
      deps.store.append(gameId, makeEvent('GAME_ENDED', {}));
      clearActiveGameIfMatches(db, gameId);
      deps.broadcaster?.broadcast(gameId);
    }

    doc.lastPublishedPackId = packId;
    saveTemplate(db, id, doc);
    return { packId };
  });
}
