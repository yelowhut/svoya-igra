import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import FormData from 'form-data';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return {
    store: new EventStore(db, 25),
    db,
    config: { ...config, mediaDir: 'data/test-http-media', adminPassword: 'secret', cookieSecret: 'test-secret' },
  };
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

describe('POST /api/games — кламп finalAnswerTimerSec', () => {
  it('POST /api/games клампит finalAnswerTimerSec в 30..300 (слишком мало → 30)', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({
      method: 'POST', url: '/api/games',
      payload: { packId, title: 'Игра', teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 5 },
      headers: { cookie },
    });
    const state = deps.store.loadState(cr.json().gameId);
    expect(state.finalAnswerTimerSec).toBe(30);
    await app.close();
  });

  it('POST /api/games клампит finalAnswerTimerSec в 30..300 (слишком много → 300)', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({
      method: 'POST', url: '/api/games',
      payload: { packId, title: 'Игра', teamCount: 3, answerTimerSec: 45, finalAnswerTimerSec: 999 },
      headers: { cookie },
    });
    const state = deps.store.loadState(cr.json().gameId);
    expect(state.finalAnswerTimerSec).toBe(300);
    await app.close();
  });

  it('POST /api/games без finalAnswerTimerSec → дефолт 60', async () => {
    const deps = makeDeps();
    const app = buildServer(deps);
    await app.ready();
    const cookie = await login(app);
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({ method: 'POST', url: '/api/packs', payload: form, headers: { ...form.getHeaders(), cookie } });
    const { packId } = up.json();
    const cr = await app.inject({
      method: 'POST', url: '/api/games',
      payload: { packId, title: 'Игра', teamCount: 2 },
      headers: { cookie },
    });
    const state = deps.store.loadState(cr.json().gameId);
    expect(state.finalAnswerTimerSec).toBe(60);
    await app.close();
  });
});
