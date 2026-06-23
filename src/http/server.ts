import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join, resolve } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import { importPackZip } from '../packs/import.js';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import { makeEvent } from '../domain/events.js';
import { registerAuth } from './auth.js';
import { registerBank } from './bank.js';
import { registerTemplates } from './templates.js';

export interface ServerDeps {
  store: EventStore;
  db: Db;
  config: Config;
  broadcaster?: { broadcast: (gameId: string) => void };
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart);
  registerAuth(app, deps.config);
  registerBank(app, deps);
  registerTemplates(app, deps);

  const webDist = resolve(process.cwd(), 'web', 'dist');
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist });
    // Чистые роуты ролей (Vite собирает их как отдельные .html-входы).
    // Запрос вида /play?game=<id> отдаёт play.html; query читает сам клиент.
    app.get('/host', (_req, reply) => reply.sendFile('index.html'));
    app.get('/play', (_req, reply) => reply.sendFile('play.html'));
    app.get('/board', (_req, reply) => reply.sendFile('board.html'));
    app.get('/admin', (_req, reply) => reply.sendFile('admin.html'));
    app.get('/admin/*', (_req, reply) => reply.sendFile('admin.html'));
  }

  app.post('/api/packs', async (req, reply) => {
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    const buf = await file.toBuffer();
    let pack;
    try { pack = importPackZip(buf, deps.config.mediaDir); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    deps.db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(pack.id, JSON.stringify(pack));
    return { packId: pack.id, title: pack.title, rounds: pack.rounds.length };
  });

  app.post('/api/games', async (req, reply) => {
    const { packId, title, teamCount } = req.body as { packId: string; title: string; teamCount: number };
    const row = deps.db.prepare('SELECT id FROM packs WHERE id = ?').get(packId);
    if (!row) return reply.code(404).send({ error: 'пак не найден' });
    const gameId = crypto.randomUUID();
    deps.store.append(gameId, makeEvent('GAME_CREATED', { gameId, packId, title, teamCount }));
    return { gameId };
  });

  app.get('/api/packs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = deps.db.prepare('SELECT data FROM packs WHERE id = ?').get(id) as { data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'не найден' });
    return JSON.parse(row.data);
  });

  app.get('/api/games', async () => {
    const rows = deps.db.prepare(
      "SELECT game_id, payload FROM events WHERE type = 'GAME_CREATED' ORDER BY seq ASC"
    ).all() as Array<{ game_id: string; payload: string }>;
    return rows.map(row => {
      const payload = JSON.parse(row.payload) as { gameId: string; title: string };
      const state = deps.store.loadState(row.game_id);
      return { gameId: row.game_id, title: payload.title, phase: state.phase };
    });
  });

  app.get('/api/games/:gameId/exists', async (req) => {
    const { gameId } = req.params as { gameId: string };
    const row = deps.db.prepare('SELECT 1 FROM events WHERE game_id = ? LIMIT 1').get(gameId);
    return { exists: !!row };
  });

  app.get('/api/games/:gameId/teams', async (req) => {
    const { gameId } = req.params as { gameId: string };
    const teams = deps.store.loadState(gameId).teams;
    return teams.map(t => ({ id: t.id, name: t.name }));
  });

  app.get('/media/:packId/*', async (req, reply) => {
    const { packId } = req.params as { packId: string; '*': string };
    const rest = (req.params as any)['*'] as string;
    const path = join(resolve(deps.config.mediaDir), packId, 'media', rest);
    if (!path.startsWith(join(resolve(deps.config.mediaDir), packId))) return reply.code(403).send();
    if (!existsSync(path)) return reply.code(404).send();
    return reply.send(createReadStream(path));
  });

  return app;
}
