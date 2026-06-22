import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { openDb } from '../../src/persistence/db.js';
import { EventStore } from '../../src/persistence/eventStore.js';
import { SessionRegistry } from '../../src/realtime/session.js';
import { attachGateway } from '../../src/realtime/gateway.js';
import { makeEvent } from '../../src/domain/events.js';
import { config } from '../../src/config.js';

let open: Socket[] = [];
let servers: Array<{ http: HttpServer; io: Server }> = [];

afterEach(async () => {
  open.forEach(s => s.close());
  open = [];
  await Promise.all(servers.map(({ io, http }) =>
    new Promise<void>(resolve => {
      io.close(() => {
        http.close(() => resolve());
      });
    }),
  ));
  servers = [];
});

async function boot() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify({ id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [] }] }));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  const http = createServer();
  const io = new Server(http);
  attachGateway(io, { store, db, sessions: new SessionRegistry(), config });
  const port: number = await new Promise(r => http.listen(() => r((http.address() as any).port)));
  servers.push({ http, io });
  return { url: `http://localhost:${port}`, store };
}

describe('реконнект', () => {
  it('после обрыва rejoin по токену восстанавливает игрока', async () => {
    const { url, store } = await boot();

    const c1 = Client(url, { transports: ['websocket'] });
    open.push(c1);
    await new Promise<void>(res => {
      c1.on('connect', () => {
        c1.emit('join', { gameId: 'g', role: 'player', firstName: 'И', lastName: 'П', teamId: 'a', clientToken: 'TOK' });
      });
      c1.on('state', () => res());
    });

    expect(store.loadState('g').players).toHaveLength(1);

    c1.close();
    await new Promise(r => setTimeout(r, 50));
    expect(store.loadState('g').players[0].connected).toBe(false);

    const c2 = Client(url, { transports: ['websocket'] });
    open.push(c2);
    await new Promise<void>(res => {
      c2.on('connect', () => c2.emit('rejoin', { clientToken: 'TOK' }));
      c2.on('state', () => res());
    });

    expect(store.loadState('g').players[0].connected).toBe(true);
    expect(store.loadState('g').players).toHaveLength(1); // не создал нового игрока
  });
});
