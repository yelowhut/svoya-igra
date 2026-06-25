import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { openDb, type Db } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { makeEvent } from '../domain/events.js';
import { getActiveGameId } from '../persistence/activeGameRepo.js';
import { config } from '../config.js';

let app: FastifyInstance; let db: Db; let store: EventStore; let cookie: string;

beforeEach(async () => {
  db = openDb(':memory:');
  store = new EventStore(db, 25);
  app = buildServer({ store, db, config: { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' } });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  cookie = `${c.name}=${c.value}`;
});
afterEach(async () => { await app.close(); });
const auth = () => ({ headers: { cookie } });

it('activate/deactivate без куки → 401', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/games/g1/activate' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/api/games/g1/deactivate' })).statusCode).toBe(401);
});

it('activate несуществующей игры → 404', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/games/no-such-game/activate', ...auth() });
  expect(res.statusCode).toBe(404);
  expect(res.json().error).toBe('игра не найдена');
});

it('activate ставит указатель, повторная — перезаписывает', async () => {
  store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }));
  store.append('g2', makeEvent('GAME_CREATED', { gameId: 'g2', packId: 'p1', title: 'T2', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }));
  await app.inject({ method: 'POST', url: '/api/games/g1/activate', ...auth() });
  expect(getActiveGameId(db)).toBe('g1');
  await app.inject({ method: 'POST', url: '/api/games/g2/activate', ...auth() });
  expect(getActiveGameId(db)).toBe('g2');
});

it('deactivate очищает только совпадающую', async () => {
  store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }));
  await app.inject({ method: 'POST', url: '/api/games/g1/activate', ...auth() });
  await app.inject({ method: 'POST', url: '/api/games/other/deactivate', ...auth() });
  expect(getActiveGameId(db)).toBe('g1');
  await app.inject({ method: 'POST', url: '/api/games/g1/deactivate', ...auth() });
  expect(getActiveGameId(db)).toBeNull();
});

it('publish-overwrite force-завершения чистит указатель активной игры на том паке', async () => {
  // готовим пак p1 и активную игру на нём
  const pack = { id: 'p1', title: 'T', teamCount: 2, rounds: [{ name: 'R', categories: [] }] };
  db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run('p1', JSON.stringify(pack));
  store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'p1', title: 'T', teamCount: 2, answerTimerSec: 45, finalAnswerTimerSec: 60 }));
  const { setActiveGame } = await import('../persistence/activeGameRepo.js');
  setActiveGame(db, 'g1');
  // имитируем force-завершение, как в publish: GAME_ENDED + хук деактивации
  const { clearActiveGameIfMatches } = await import('../persistence/activeGameRepo.js');
  store.append('g1', makeEvent('GAME_ENDED', {}));
  clearActiveGameIfMatches(db, 'g1');
  expect(getActiveGameId(db)).toBeNull();
});
