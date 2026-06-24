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
  const pack = {
    id: 'p', title: 'T',
    rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
      questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'A', value: 100, special: 'none' }] }] }],
  };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec: 45 }));

  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config });
  teardowns.push(() => new Promise<void>((res) => { ioServer.close(); httpServer.close(() => res()); }));
  const port: number = await new Promise(r => httpServer.listen(() => r((httpServer.address() as any).port)));
  return { url: `http://localhost:${port}`, store, db };
}

let open: Socket[] = [];
afterEach(async () => {
  open.forEach(s => s.disconnect()); open = [];
  await Promise.all(teardowns.map(fn => fn())); teardowns = [];
});

/** Join as player with newTeamName, returns { socket, playerId, teamId } */
function joinPlayerNew(url: string, clientToken: string, teamName: string): Promise<{ socket: Socket; playerId: string; teamId: string }> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise((resolve) => {
    c.on('connect', () => {
      c.emit('join', { gameId: 'g', firstName: 'А', lastName: 'Б', newTeamName: teamName, clientToken, role: 'player' });
      c.once('youAre', (d: any) => resolve({ socket: c, playerId: d.playerId, teamId: d.teamId }));
    });
  });
}

/** Reclaim: fresh socket, same clientToken - simulate page reopen */
function reclaimPlayer(url: string, clientToken: string): Promise<{ socket: Socket; playerId: string; teamId: string }> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise((resolve) => {
    c.on('connect', () => {
      // Pass a different teamId to confirm it's ignored when reclaiming
      c.emit('join', { gameId: 'g', firstName: 'Х', lastName: 'Й', newTeamName: 'ДругаяКоманда', clientToken, role: 'player' });
      c.once('youAre', (d: any) => resolve({ socket: c, playerId: d.playerId, teamId: d.teamId }));
    });
  });
}

describe('gateway reclaim — idempotent join по clientToken', () => {
  it('повторный join с тем же clientToken не создаёт дубликат игрока', async () => {
    const { url, store } = await setup();

    // First join — creates player P with a team
    const first = await joinPlayerNew(url, 'tok-reclaim', 'Команда1');

    // Second join with same clientToken (simulating page reopen / server restart)
    const second = await reclaimPlayer(url, 'tok-reclaim');

    const st = store.loadState('g');
    expect(st.players).toHaveLength(1);
    expect(second.playerId).toBe(first.playerId);
    expect(second.teamId).toBe(first.teamId);
  });

  it('после reclaim отключение первого сокета не выставляет connected=false (bind забрал сессию)', async () => {
    const { url, store } = await setup();

    // First join
    const first = await joinPlayerNew(url, 'tok-disc', 'КомандаДиск');

    // Second join (reclaim) with same token — first socket's session is taken over by bind()
    const second = await reclaimPlayer(url, 'tok-disc');
    void second;

    // Disconnect first socket and wait for server to process the disconnect
    await new Promise<void>(resolve => {
      first.socket.disconnect();
      // Poll until the connected field stabilizes (bounded wait ~1s)
      let attempts = 0;
      const check = () => {
        attempts++;
        // After reclaim, first socket's socketId is gone from bySocketMap → markDisconnected returns undefined
        // → no PLAYER_DISCONNECTED event → connected stays true
        const st = store.loadState('g');
        if (st.players[0]?.connected === true || attempts >= 20) resolve();
        else setTimeout(check, 50);
      };
      setTimeout(check, 100);
    });

    const st = store.loadState('g');
    expect(st.players).toHaveLength(1);
    expect(st.players[0].id).toBe(first.playerId);
    // The bind() during reclaim removed socket1 from bySocketMap, so its disconnect
    // does NOT append PLAYER_DISCONNECTED → player remains connected: true
    expect(st.players[0].connected).toBe(true);
  });

  it('другой clientToken создаёт отдельного игрока', async () => {
    const { url, store } = await setup();

    // First player
    await joinPlayerNew(url, 'tok-A', 'КомандаА');

    // Second player with different token
    const c2 = Client(url, { transports: ['websocket'] }); open.push(c2);
    await new Promise<void>(resolve => {
      c2.on('connect', () => {
        c2.emit('join', { gameId: 'g', firstName: 'В', lastName: 'Г', newTeamName: 'КомандаБ', clientToken: 'tok-B', role: 'player' });
        c2.once('youAre', () => resolve());
      });
    });

    const st = store.loadState('g');
    expect(st.players).toHaveLength(2);
  });
});
