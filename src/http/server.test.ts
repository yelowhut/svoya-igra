import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import FormData from 'form-data';
import { buildServer } from './server.js';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { config } from '../config.js';

function makeDeps() {
  const db = openDb(':memory:');
  return { store: new EventStore(db, 25), db, config: { ...config, mediaDir: 'data/test-http-media' } };
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
    // Use form-data (npm package) instead of global FormData because
    // light-my-request does not serialize the global FormData/Blob.
    // form-data is a Readable stream that inject handles natively.
    const form = new FormData();
    form.append('file', packZip(), { filename: 'pack.zip', contentType: 'application/zip' });
    const up = await app.inject({
      method: 'POST',
      url: '/api/packs',
      payload: form,
      headers: form.getHeaders(),
    });
    expect(up.statusCode).toBe(200);
    const { packId } = up.json();
    expect(packId).toBeDefined();

    const cr = await app.inject({ method: 'POST', url: '/api/games', payload: { packId, title: 'Игра', teamCount: 2 } });
    expect(cr.statusCode).toBe(200);
    expect(cr.json().gameId).toBeDefined();
    await app.close();
  });

  it('exists=false для несуществующей игры', async () => {
    const app = buildServer(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/exists' });
    expect(res.json().exists).toBe(false);
    await app.close();
  });
});
