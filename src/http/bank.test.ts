import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
}
async function authed(app: ReturnType<typeof buildServer>) {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
  const c = login.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('bank API', () => {
  it('гард: 401 без куки', async () => {
    const app = buildServer(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/bank/categories' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('CRUD категорий', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const create = await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } });
    expect(create.statusCode).toBe(200);
    const id = create.json().id as string;

    const list = await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } });
    expect(list.json()).toEqual([{ id, name: 'Кино', position: 1, questionCount: 0 }]);

    const ren = await app.inject({ method: 'PUT', url: `/api/bank/categories/${id}`, headers: { cookie }, payload: { name: 'Фильмы' } });
    expect(ren.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json()[0].name).toBe('Фильмы');

    expect((await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/bank/categories/нет', headers: { cookie }, payload: { name: 'X' } })).statusCode).toBe(404);
    await app.close();
  });

  it('move категорий', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const a = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'A' } })).json().id;
    const b = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'B' } })).json().id;
    await app.inject({ method: 'POST', url: `/api/bank/categories/${b}/move`, headers: { cookie }, payload: { direction: 'up' } });
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json().map((c: any) => c.id)).toEqual([b, a]);
    await app.close();
  });

  it('CRUD вопросов; PUT не принимает category_id', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;

    const cq = await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} });
    expect(cq.statusCode).toBe(200);
    const qid = cq.json().id;

    const upd = await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { type: 'text', prompt: 'Кто?', answer: 'X' } });
    expect(upd.statusCode).toBe(200);
    const qs = await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } });
    expect(qs.json()[0]).toMatchObject({ id: qid, categoryId: cat, type: 'text', prompt: 'Кто?', answer: 'X', media: null });

    // перенос между категориями запрещён
    const bad = await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { category_id: 'другая' } });
    expect(bad.statusCode).toBe(400);
    // неизвестный тип
    expect((await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { type: 'video' } })).statusCode).toBe(400);
    // вопрос в несуществующую категорию
    expect((await app.inject({ method: 'POST', url: '/api/bank/categories/нет/questions', headers: { cookie }, payload: {} })).statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/bank/questions/${qid}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } })).json()).toEqual([]);
    await app.close();
  });

  it('DELETE категории каскадно удаляет вопросы', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;
    await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} });
    const del = await app.inject({ method: 'DELETE', url: `/api/bank/categories/${cat}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie } })).json()).toEqual([]);
    await app.close();
  });
});
