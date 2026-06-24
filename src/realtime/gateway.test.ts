import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { SessionRegistry } from './session.js';
import { attachGateway } from './gateway.js';
import { makeEvent } from '../domain/events.js';
import { config } from '../config.js';

let teardowns: Array<() => Promise<void>> = [];

function setup() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'SECRET', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 45 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config });
  teardowns.push(() => new Promise<void>((res) => { ioServer.close(); httpServer.close(() => res()); }));
  return new Promise<{ url: string; ioServer: Server; httpServer: any }>(res => {
    httpServer.listen(() => {
      const port = (httpServer.address() as any).port;
      res({ url: `http://localhost:${port}`, ioServer, httpServer });
    });
  });
}

let open: Socket[] = [];
afterEach(async () => {
  open.forEach(s => s.close()); open = [];
  await Promise.all(teardowns.map(fn => fn())); teardowns = [];
});

describe('gateway', () => {
  it('player join получает состояние без ответа', async () => {
    const { url } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);
    const state: any = await new Promise(res => {
      c.on('connect', () => c.emit('join', { gameId: 'g', firstName: 'И', lastName: 'П', teamId: 'a', clientToken: 'tok', role: 'player' }));
      c.on('state', res);
    });
    expect(JSON.stringify(state)).not.toContain('SECRET');
    expect(state.teams).toHaveLength(1);
  });
});
