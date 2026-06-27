import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import FormData from 'form-data';
import { randomBytes } from 'node:crypto';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';
import { makeEvent } from '../domain/events.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-http-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
}

async function login(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = r.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}
function packZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('game.json', Buffer.from(JSON.stringify({
    title: 'X', rounds: [{ name: 'R', categories: [{ name: 'C', questions: [
      { type: 'text', prompt: 'p', answer: 'a', value: 100, special: 'none' }] }] }],
  })));
  return zip.toBuffer();
}

describe('HTTP API', () => {
  it('загрузка пака и создание игры', async () => {
    const app = buildServer(makeDeps());
    await app.ready();
    const cookie = await login(app);
    // Use form-data (npm package) instead of global FormData because
    // light-my-request does not serialize the global FormData/Blob.
    // form-data is a Readable stream that inject handles natively.
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({
      method: 'POST',
      url: '/api/packs',
      payload: form,
      headers: { ...form.getHeaders(), cookie },
    });
    expect(up.statusCode).toBe(200);
    const { packId } = up.json();
    expect(packId).toBeDefined();

    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 }, headers: { cookie } });
    expect(cr.statusCode).toBe(200);
    expect(cr.json().gameId).toBeDefined();
    await app.close();
  });

  it('пак с медиа крупнее 1 МБ (старый дефолт multipart) грузится без 413', async () => {
    const app = buildServer(makeDeps());
    await app.ready();
    const cookie = await login(app);

    const zip = new AdmZip();
    zip.addFile('game.json', Buffer.from(JSON.stringify({
      title: 'Большой', rounds: [{ name: 'R', categories: [{ name: 'C', questions: [
        { type: 'audio', prompt: 'p', media: 'media/big.wav', answer: 'a', value: 100, special: 'none' }] }] }],
    })));
    zip.addFile('media/big.wav', randomBytes(3 * 1024 * 1024)); // 3 МБ несжимаемых данных — ZIP заведомо > 1 МБ
    const buf = zip.toBuffer();
    expect(buf.length).toBeGreaterThan(1024 * 1024);

    const form = new FormData();
    form.append('file', buf, { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(up.statusCode).toBe(200);
    expect(up.json().packId).toBeDefined();
    await app.close();
  });

  it('exists=false для несуществующей игры', async () => {
    const app = buildServer(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/exists' });
    expect(res.json().exists).toBe(false);
    await app.close();
  });

  it('GET /api/games/:gameId/teams возвращает команды', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);

    // Create a game
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 }, headers: { cookie } });
    const { gameId } = cr.json();

    // Append a TEAM_CREATED event directly via the store
    deps.store.append(gameId, makeEvent('TEAM_CREATED', { teamId: 't1', name: 'Львы' }));

    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}/teams` });
    expect(res.statusCode).toBe(200);
    const teams = res.json() as Array<{ id: string; name: string }>;
    expect(teams.length).toBe(1);
    expect(teams[0]).toEqual({ id: 't1', name: 'Львы' });
    await app.close();
  });

  it('POST /api/games проносит answerTimerSec (кламп 10–120)', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2, answerTimerSec: 999 }, headers: { cookie } });
    const { gameId } = cr.json();
    const state = deps.store.loadState(gameId);
    expect(state.answerTimerSec).toBe(120); // заклампано
    await app.close();
  });

  it('POST /api/games без answerTimerSec → дефолт 45', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 }, headers: { cookie } });
    const state = deps.store.loadState(cr.json().gameId);
    expect(state.answerTimerSec).toBe(45);
    await app.close();
  });

  it('DELETE /api/games/:id удаляет события и снимает активную, игра пропадает из списка', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);

    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const { gameId } = (await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Удаляемая', teamCount: 2 }, headers: { cookie } })).json();
    deps.store.append(gameId, makeEvent('TEAM_CREATED', { teamId: 't1', name: 'Львы' }));
    await app.inject({ method: 'POST', url: `/api/games/${gameId}/activate`, headers: { cookie } });

    const del = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    // событий нет, exists=false, активной нет, в списке отсутствует
    expect((await app.inject({ method: 'GET', url: `/api/games/${gameId}/exists` })).json().exists).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/active-game' })).json()).toBeNull();
    const list = (await app.inject({ method: 'GET', url: '/api/games', headers: { cookie } })).json() as Array<{ gameId: string }>;
    expect(list.find(g => g.gameId === gameId)).toBeUndefined();
    await app.close();
  });

  it('GET /api/games возвращает список игр с title и phase', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);

    // Upload a pack first
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();

    // Create two games
    const cr1 = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра 1', teamCount: 2 }, headers: { cookie } });
    const cr2 = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра 2', teamCount: 3 }, headers: { cookie } });
    const gameId1 = cr1.json().gameId;
    const gameId2 = cr2.json().gameId;

    const res = await app.inject({ method: 'GET', url: '/api/games', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ gameId: string; title: string; phase: string }>;

    expect(list.length).toBeGreaterThanOrEqual(2);
    const g1 = list.find(g => g.gameId === gameId1);
    const g2 = list.find(g => g.gameId === gameId2);
    expect(g1).toBeDefined();
    expect(g1!.title).toBe('Игра 1');
    expect(g1!.phase).toBeDefined();
    expect(g2).toBeDefined();
    expect(g2!.title).toBe('Игра 2');
    expect(g2!.phase).toBeDefined();
    await app.close();
  });
});

describe('admin auth через buildServer', () => {
  function makeAuthedDeps() {
    const db = openDb(':memory:');
    return {
      store: new EventStore(db, 25),
      db,
      config: { ...config, mediaDir: 'data/test-http-media', adminPassword: 'secret', cookieSecret: 'test-secret' },
    };
  }

  it('session=false без куки; после login — session=true', async () => {
    const app = buildServer(makeAuthedDeps());
    const s0 = await app.inject({ method: 'GET', url: '/api/admin/session' });
    expect(s0.json()).toEqual({ authenticated: false });

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    expect(login.statusCode).toBe(200);
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;

    const s1 = await app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: `${c.name}=${c.value}` } });
    expect(s1.json()).toEqual({ authenticated: true });
    await app.close();
  });
});
