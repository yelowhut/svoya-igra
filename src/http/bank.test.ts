import { describe, it, expect } from 'vitest';
import FormData from 'form-data';
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

  it('PUT отвергает недопустимый путь медиа (traversal)', async () => {
    const app = buildServer(makeDeps());
    const cookie = await authed(app);
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;
    const qid = (await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} })).json().id;
    const bad = await app.inject({ method: 'PUT', url: `/api/bank/questions/${qid}`, headers: { cookie }, payload: { media: '../../evil' } });
    expect(bad.statusCode).toBe(400);
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

describe('bank media upload', () => {
  function makeDeps2() {
    const db = openDb(':memory:');
    return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
  }
  async function authed2(app: ReturnType<typeof buildServer>) {
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    return `${c.name}=${c.value}`;
  }
  async function makeQuestion(app: ReturnType<typeof buildServer>, cookie: string) {
    const cat = (await app.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie }, payload: { name: 'Кино' } })).json().id;
    const q = (await app.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie }, payload: {} })).json().id;
    return { cat, q };
  }

  it('успешная загрузка PNG → путь bank/media/<id>-…', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { cat, q } = await makeQuestion(app, cookie);
    const form = new FormData();
    form.append('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: 'pic.png', contentType: 'image/png' });
    const up = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(up.statusCode).toBe(200);
    expect(up.json().path).toBe(`bank/media/${q}-pic.png`);
    const qs = (await app.inject({ method: 'GET', url: `/api/bank/categories/${cat}/questions`, headers: { cookie } })).json();
    expect(qs[0].media).toBe(`bank/media/${q}-pic.png`);
    await app.close();
  });

  it('отклоняет недопустимый MIME (415)', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { q } = await makeQuestion(app, cookie);
    const form = new FormData();
    form.append('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    const up = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: form, headers: { ...form.getHeaders(), cookie } });
    expect(up.statusCode).toBe(415);
    await app.close();
  });

  it('загрузка нового медиа удаляет старый файл (GC)', async () => {
    const app = buildServer(makeDeps2());
    const cookie = await authed2(app);
    const { q } = await makeQuestion(app, cookie);
    const f1 = new FormData(); f1.append('file', Buffer.from([1]), { filename: 'a.png', contentType: 'image/png' });
    await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: f1, headers: { ...f1.getHeaders(), cookie } });
    const f2 = new FormData(); f2.append('file', Buffer.from([2]), { filename: 'b.png', contentType: 'image/png' });
    const up2 = await app.inject({ method: 'POST', url: `/api/bank/questions/${q}/media`, payload: f2, headers: { ...f2.getHeaders(), cookie } });
    expect(up2.json().path).toBe(`bank/media/${q}-b.png`);
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(existsSync(join('data/test-bank-media', 'bank', 'media', `${q}-a.png`))).toBe(false);
    expect(existsSync(join('data/test-bank-media', 'bank', 'media', `${q}-b.png`))).toBe(true);
    await app.close();
  });
});

describe('bank export/import', () => {
  function makeDeps3() {
    const db = openDb(':memory:');
    return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-bank-media', adminPassword: 'secret', cookieSecret: 'test-secret' } };
  }
  async function authed3(app: ReturnType<typeof buildServer>) {
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const c = login.cookies.find(x => x.name === 'svoya_admin')!;
    return `${c.name}=${c.value}`;
  }

  it('export отдаёт zip; import втягивает в другой сервер', async () => {
    const app1 = buildServer(makeDeps3());
    const cookie1 = await authed3(app1);
    const cat = (await app1.inject({ method: 'POST', url: '/api/bank/categories', headers: { cookie: cookie1 }, payload: { name: 'Кино' } })).json().id;
    await app1.inject({ method: 'POST', url: `/api/bank/categories/${cat}/questions`, headers: { cookie: cookie1 }, payload: {} });

    const exp = await app1.inject({ method: 'GET', url: '/api/bank/export', headers: { cookie: cookie1 } });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('application/zip');
    const zipBuf = exp.rawPayload;

    const app2 = buildServer(makeDeps3());
    const cookie2 = await authed3(app2);
    const FormDataMod = (await import('form-data')).default;
    const form = new FormDataMod();
    form.append('file', zipBuf, { filename: 'bank.zip', contentType: 'application/zip' });
    const imp = await app2.inject({ method: 'POST', url: '/api/bank/import', payload: form, headers: { ...form.getHeaders(), cookie: cookie2 } });
    expect(imp.statusCode).toBe(200);
    expect(imp.json()).toEqual({ categories: 1, questions: 1 });
    expect((await app2.inject({ method: 'GET', url: '/api/bank/categories', headers: { cookie: cookie2 } })).json()[0].name).toBe('Кино');
    await app1.close(); await app2.close();
  });
});
