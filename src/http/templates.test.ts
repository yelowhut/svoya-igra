import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-tpl-media', adminPassword: 'secret' } };
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
