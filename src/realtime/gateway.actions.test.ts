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

async function setup() {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'S', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }));
  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config: { ...config, minReactionMs: 100, blockMinMs: 500, blockMaxMs: 700 } });
  teardowns.push(() => new Promise<void>((res) => { ioServer.close(); httpServer.close(() => res()); }));
  const port: number = await new Promise(r => httpServer.listen(() => r((httpServer.address() as any).port)));
  return { url: `http://localhost:${port}`, store };
}

let open: Socket[] = [];
afterEach(async () => {
  open.forEach(s => s.close()); open = [];
  await Promise.all(teardowns.map(fn => fn())); teardowns = [];
});

function join(url: string, role: string, teamId: string, token: string): Promise<Socket> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise(res => {
    c.on('connect', () => { c.emit('join', { gameId: 'g', firstName: 'И', lastName: 'П', teamId, clientToken: token, role }); res(c); });
  });
}

describe('gateway actions', () => {
  it('фальстарт-нажатие возвращает blocked и не попадает в очередь', async () => {
    const { url, store } = await setup();
    const player = await join(url, 'player', 'a', 'tokA');
    const blocked: any = await new Promise(res => {
      player.on('blocked', res);
      player.emit('playerBuzz', { reaction: 50 }); // < порога 100
    });
    expect(blocked.untilMs).toBeGreaterThan(0);
    expect(store.loadState('g').buzzQueue).toHaveLength(0);
  });

  it('hostAction от игрока игнорируется (не его роль)', async () => {
    const { url, store } = await setup();
    const player = await join(url, 'player', 'a', 'tokP');
    player.emit('hostAction', { action: 'startGame' });
    await new Promise(r => setTimeout(r, 60));
    expect(store.loadState('g').phase).toBe('LOBBY'); // не сдвинулось в ROUND_INTRO
  });

  it('валидный buzz попадает в очередь команды', async () => {
    const { url, store } = await setup();
    const host = await join(url, 'host', 'a', 'tokH');
    host.emit('hostAction', { action: 'selectQuestion', data: { questionId: 'q1', value: 100, special: 'none' } });
    host.emit('hostAction', { action: 'open' });
    const player = await join(url, 'player', 'a', 'tokA');
    await new Promise(r => setTimeout(r, 50));
    player.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 50));
    expect(store.loadState('g').buzzQueue.map(e => e.teamId)).toContain('a');
  });
});
