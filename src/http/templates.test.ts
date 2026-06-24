import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';
import { makeEvent } from '../domain/events.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-tpl-media', adminPassword: 'secret' }, broadcaster: undefined as { broadcast: (g: string) => void } | undefined };
}
async function authed(app: ReturnType<typeof buildServer>) {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('game-templates CRUD', () => {
  it('401 без куки', async () => {
    const app = buildServer(makeDeps());
    expect((await app.inject({ method: 'GET', url: '/api/game-templates' })).statusCode).toBe(401);
    await app.close();
  });
  it('create → get → list → delete', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const create = await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id as string;

    const get = await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } });
    expect(get.json().rounds[0].columns).toHaveLength(5);

    const list = await app.inject({ method: 'GET', url: '/api/game-templates', headers: { cookie } });
    expect(list.json()[0].id).toBe(id);

    const del = await app.inject({ method: 'DELETE', url: `/api/game-templates/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });
  it('PUT сохраняет документ', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
    const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
    doc.title = 'Новое имя';
    const put = await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json().title).toBe('Новое имя');
    await app.close();
  });
});

it('preflight: published=false без публикации, 0 игр', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const pf = await app.inject({ method: 'GET', url: `/api/game-templates/${id}/publish/preflight`, headers: { cookie } });
  expect(pf.json()).toEqual({ published: false, referencingGames: 0 });
  await app.close();
});

it('preflight считает только активные игры на packId', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  // шаблон с уже опубликованным packId
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
  doc.lastPublishedPackId = 'pack1';
  await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
  // активная игра на pack1
  deps.store.append('g1', makeEvent('GAME_CREATED', { gameId: 'g1', packId: 'pack1', title: 'T', teamCount: 3, answerTimerSec: 45 }));
  // завершённая игра на pack1
  deps.store.append('g2', makeEvent('GAME_CREATED', { gameId: 'g2', packId: 'pack1', title: 'T', teamCount: 3, answerTimerSec: 45 }));
  deps.store.append('g2', makeEvent('GAME_ENDED', {}));
  const pf = await app.inject({ method: 'GET', url: `/api/game-templates/${id}/publish/preflight`, headers: { cookie } });
  expect(pf.json()).toEqual({ published: true, referencingGames: 1 });
  await app.close();
});

async function makeValidTemplate(app: ReturnType<typeof buildServer>, cookie: string, db: any) {
  // банк: категория + текстовый вопрос
  db.prepare('INSERT INTO bank_categories (id,name,position) VALUES (?,?,?)').run('c1', 'Кино', 1);
  db.prepare('INSERT INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)')
    .run('q1', 'c1', 'text', 'вопрос', 'ответ', null, 1);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: {} })).json().id;
  const doc = (await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json();
  doc.title = 'Игра';
  doc.rounds[0].columns = [{ id: 'k1', value: 100 }];
  doc.rounds[0].rows = [{ id: 'row1', categoryId: 'c1', cells: [{ columnId: 'k1', questionId: 'q1', special: 'none' }] }];
  await app.inject({ method: 'PUT', url: `/api/game-templates/${id}`, headers: { cookie }, payload: doc });
  return id;
}

it('publish невалидного → 400 с problems', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = (await app.inject({ method: 'POST', url: '/api/game-templates', headers: { cookie }, payload: { template: '5x5' } })).json().id;
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().problems.length).toBeGreaterThan(0);
  await app.close();
});

it('publish валидного (new) пишет пак и возвращает packId', async () => {
  const deps = makeDeps();
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = await makeValidTemplate(app, cookie, deps.db);
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } });
  expect(res.statusCode).toBe(200);
  const packId = res.json().packId as string;
  expect(deps.db.prepare('SELECT id FROM packs WHERE id=?').get(packId)).toBeTruthy();
  // lastPublishedPackId сохранён
  expect((await app.inject({ method: 'GET', url: `/api/game-templates/${id}`, headers: { cookie } })).json().lastPublishedPackId).toBe(packId);
  await app.close();
});

it('publish (overwrite) форс-завершает активную игру', async () => {
  const deps = makeDeps();
  const ended: string[] = [];
  deps.broadcaster = { broadcast: (g: string) => ended.push(g) };
  const app = buildServer(deps);
  const cookie = await authed(app);
  const id = await makeValidTemplate(app, cookie, deps.db);
  const packId = (await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'new' } })).json().packId;
  deps.store.append('gLive', makeEvent('GAME_CREATED', { gameId: 'gLive', packId, title: 'T', teamCount: 3, answerTimerSec: 45 }));
  const res = await app.inject({ method: 'POST', url: `/api/game-templates/${id}/publish`, headers: { cookie }, payload: { mode: 'overwrite' } });
  expect(res.statusCode).toBe(200);
  expect(deps.store.loadState('gLive').phase).toBe('GAME_END');
  expect(ended).toContain('gLive');
  await app.close();
});
