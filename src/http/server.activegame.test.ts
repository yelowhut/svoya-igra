import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { openDb, type Db } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { makeEvent } from '../domain/events.js';
import { config } from '../config.js';

let app: FastifyInstance; let db: Db; let store: EventStore;

function seedPack(packId: string, title: string, rounds: number) {
  const pack = { id: packId, title, teamCount: 4, rounds: Array.from({ length: rounds }, () => ({ name: 'R', categories: [] })) };
  db.prepare('INSERT OR REPLACE INTO packs (id,data) VALUES (?,?)').run(packId, JSON.stringify(pack));
}

beforeEach(async () => {
  db = openDb(':memory:');
  store = new EventStore(db, 25);
  app = buildServer({ store, db, config: { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' } });
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe('GET /api/active-game', () => {
  it('null, когда активной игры нет', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/active-game' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toBeNull();
  });

  it('возвращает полный набор метрик для активной игры', async () => {
    seedPack('p1', 'Пятничный квиз', 3);
    const gameId = 'g1';
    store.append(gameId, makeEvent('GAME_CREATED', { gameId, packId: 'p1', title: 'Пятничный квиз', teamCount: 6, answerTimerSec: 45 }));
    // активируем напрямую через репозиторий-эндпоинт нельзя без куки — ставим указатель в БД:
    const { setActiveGame } = await import('../persistence/activeGameRepo.js');
    setActiveGame(db, gameId);

    const r = await app.inject({ method: 'GET', url: '/api/active-game' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({
      gameId, title: 'Пятничный квиз', phase: 'LOBBY',
      teamCount: 6, playerCount: 0, totalRounds: 3, currentRound: 1,
    });
  });
});

describe('гарды и список паков', () => {
  it('GET /api/packs без куки → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/packs' });
    expect(r.statusCode).toBe(401);
  });

  it('POST /api/games без куки → 401', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/games', payload: { packId: 'p1', title: 'X', teamCount: 2 } });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/games без куки → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/games' });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/packs с кукой → список', async () => {
    seedPack('p1', 'Квиз', 2);
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    const cookie = `${c.name}=${c.value}`;
    const r = await app.inject({ method: 'GET', url: '/api/packs', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ id: 'p1', title: 'Квиз', rounds: 2 }]);
  });
});
