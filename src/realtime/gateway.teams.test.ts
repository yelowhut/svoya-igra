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
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2 }));
  // Pre-create one team 'existingTeam' so host actions have a target
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'existingTeam', name: 'Старая' }));

  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  attachGateway(ioServer, { store, db, sessions: new SessionRegistry(), config });
  teardowns.push(() => new Promise<void>((res) => { ioServer.close(); httpServer.close(() => res()); }));
  const port: number = await new Promise(r => httpServer.listen(() => r((httpServer.address() as any).port)));
  return { url: `http://localhost:${port}`, store, db };
}

let open: Socket[] = [];
afterEach(async () => {
  open.forEach(s => s.close()); open = [];
  await Promise.all(teardowns.map(fn => fn())); teardowns = [];
});

/** Join as host, returns socket */
function joinHost(url: string, token = 'hostToken'): Promise<Socket> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise(res => {
    c.on('connect', () => {
      c.emit('join', { gameId: 'g', firstName: 'Х', lastName: 'Г', teamId: 'existingTeam', clientToken: token, role: 'host' });
      // Wait for first state so host is fully joined before we send actions
      c.once('state', () => res(c));
    });
  });
}

/** Helper: collect the next `state` event on socket `c` */
function nextState(c: Socket): Promise<any> {
  return new Promise(res => c.once('state', res));
}

/** Helper: collect the next `appError` event on socket `c` */
function nextError(c: Socket): Promise<any> {
  return new Promise(res => c.once('appError', res));
}

describe('gateway teams — player join', () => {
  it('player join с newTeamName создаёт команду и добавляет игрока', async () => {
    const { url, store } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);

    const youAreAndState = await new Promise<{ youAre: any; state: any }>((res) => {
      let youAre: any;
      c.on('connect', () => {
        c.emit('join', {
          gameId: 'g', firstName: 'А', lastName: 'Б',
          newTeamName: 'Новая',
          clientToken: 'tokNew', role: 'player',
        });
      });
      c.on('youAre', (d: any) => { youAre = d; });
      c.on('state', (s: any) => { if (youAre) res({ youAre, state: s }); });
    });

    const st = store.loadState('g');
    const newTeam = st.teams.find(t => t.name === 'Новая');
    expect(newTeam).toBeDefined();
    const player = st.players.find(p => p.teamId === newTeam!.id);
    expect(player).toBeDefined();
    expect(youAreAndState.youAre.teamId).toBe(newTeam!.id);
  });

  it('player join с invalid newTeamName — error, команда не создана, игрок не добавлен', async () => {
    const { url, store } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);

    const err = await new Promise<any>((res) => {
      c.on('connect', () => {
        c.emit('join', {
          gameId: 'g', firstName: 'А', lastName: 'Б',
          newTeamName: 'bad/name',
          clientToken: 'tokBad', role: 'player',
        });
      });
      c.on('appError', res);
    });

    expect(err.message).toBe('Недопустимое имя команды');
    const st = store.loadState('g');
    expect(st.teams.find(t => t.name === 'bad/name')).toBeUndefined();
    expect(st.players).toHaveLength(0);
  });

  it('player join без teamId и без newTeamName — error', async () => {
    const { url, store } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);

    const err = await new Promise<any>((res) => {
      c.on('connect', () => {
        c.emit('join', {
          gameId: 'g', firstName: 'А', lastName: 'Б',
          clientToken: 'tokNone', role: 'player',
          // no teamId, no newTeamName
        });
      });
      c.on('appError', res);
    });

    expect(err.message).toBe('Выберите или создайте команду');
    expect(store.loadState('g').players).toHaveLength(0);
  });
});

describe('gateway teams — hostAction renameTeam', () => {
  it('host renameTeam — имя команды меняется', async () => {
    const { url, store } = await setup();
    const host = await joinHost(url);

    const stateP = nextState(host);
    host.emit('hostAction', { action: 'renameTeam', data: { teamId: 'existingTeam', name: 'Переименованная' } });
    await stateP;

    const st = store.loadState('g');
    expect(st.teams.find(t => t.id === 'existingTeam')?.name).toBe('Переименованная');
  });

  it('host renameTeam с invalid именем — error, имя не меняется', async () => {
    const { url, store } = await setup();
    const host = await joinHost(url);

    const errP = nextError(host);
    host.emit('hostAction', { action: 'renameTeam', data: { teamId: 'existingTeam', name: 'bad/name' } });
    const err = await errP;

    expect(err.message).toBe('Недопустимое имя команды');
    expect(store.loadState('g').teams.find(t => t.id === 'existingTeam')?.name).toBe('Старая');
  });
});

describe('gateway teams — hostAction deleteTeam', () => {
  it('host deleteTeam на команду с игроком — error, команда остаётся', async () => {
    const { url, store } = await setup();
    // First join a player to the existingTeam
    const player = Client(url, { transports: ['websocket'] }); open.push(player);
    await new Promise<void>(res => {
      player.on('connect', () => {
        player.emit('join', { gameId: 'g', firstName: 'П', lastName: 'И', teamId: 'existingTeam', clientToken: 'tokP', role: 'player' });
        player.once('youAre', () => res());
      });
    });

    const host = await joinHost(url);
    const errP = nextError(host);
    host.emit('hostAction', { action: 'deleteTeam', data: { teamId: 'existingTeam' } });
    const err = await errP;

    expect(err.message).toBe('Нельзя удалить команду с игроками');
    expect(store.loadState('g').teams.find(t => t.id === 'existingTeam')).toBeDefined();
  });

  it('host deleteTeam на пустую команду — команда удаляется', async () => {
    const { url, store } = await setup();
    const host = await joinHost(url);

    const stateP = nextState(host);
    host.emit('hostAction', { action: 'deleteTeam', data: { teamId: 'existingTeam' } });
    await stateP;

    expect(store.loadState('g').teams.find(t => t.id === 'existingTeam')).toBeUndefined();
  });
});

describe('gateway teams — hostAction movePlayer', () => {
  it('host movePlayer — teamId игрока меняется', async () => {
    const { url, store } = await setup();
    // Create a second team to move player to
    store.append('g', makeEvent('TEAM_CREATED', { teamId: 'teamB', name: 'Б' }));

    // Join a player to existingTeam
    let playerId: string;
    const player = Client(url, { transports: ['websocket'] }); open.push(player);
    await new Promise<void>(res => {
      player.on('connect', () => {
        player.emit('join', { gameId: 'g', firstName: 'П', lastName: 'И', teamId: 'existingTeam', clientToken: 'tokP2', role: 'player' });
        player.once('youAre', (d: any) => { playerId = d.playerId; res(); });
      });
    });

    const host = await joinHost(url, 'hostToken2');
    const stateP = nextState(host);
    host.emit('hostAction', { action: 'movePlayer', data: { playerId: playerId!, teamId: 'teamB' } });
    await stateP;

    const st = store.loadState('g');
    expect(st.players.find(p => p.id === playerId!)?.teamId).toBe('teamB');
  });

  it('host movePlayer на несуществующий teamId — appError, teamId игрока не меняется', async () => {
    const { url, store } = await setup();

    // Join a player to existingTeam
    let playerId: string;
    const player = Client(url, { transports: ['websocket'] }); open.push(player);
    await new Promise<void>(res => {
      player.on('connect', () => {
        player.emit('join', { gameId: 'g', firstName: 'П', lastName: 'И', teamId: 'existingTeam', clientToken: 'tokP3', role: 'player' });
        player.once('youAre', (d: any) => { playerId = d.playerId; res(); });
      });
    });

    const host = await joinHost(url, 'hostToken3');
    const errP = nextError(host);
    host.emit('hostAction', { action: 'movePlayer', data: { playerId: playerId!, teamId: 'nonexistentTeam' } });
    const err = await errP;

    expect(err.message).toBe('Команда не найдена');
    const st = store.loadState('g');
    expect(st.players.find(p => p.id === playerId!)?.teamId).toBe('existingTeam');
  });
});

describe('gateway teams — player join с несуществующим teamId', () => {
  it('player join с teamId которого нет — appError, игрок не добавлен', async () => {
    const { url, store } = await setup();
    const c = Client(url, { transports: ['websocket'] }); open.push(c);

    const err = await new Promise<any>((res) => {
      c.on('connect', () => {
        c.emit('join', {
          gameId: 'g', firstName: 'А', lastName: 'Б',
          teamId: 'nonexistentTeam',
          clientToken: 'tokBadTeam', role: 'player',
        });
      });
      c.on('appError', res);
    });

    expect(err.message).toBe('Команда не найдена');
    expect(store.loadState('g').players).toHaveLength(0);
  });
});

describe('gateway teams — hostAction startRound без команд', () => {
  it('host startRound при нулевом числе команд — appError, фаза остаётся LOBBY', async () => {
    const { url, store } = await setup();

    // Delete the pre-created team (no players → guard passes)
    const host = await joinHost(url, 'hostToken4');
    const stateAfterDelete = nextState(host);
    host.emit('hostAction', { action: 'deleteTeam', data: { teamId: 'existingTeam' } });
    await stateAfterDelete;

    // Now there are zero teams — startRound should error
    const errP = nextError(host);
    host.emit('hostAction', { action: 'startRound', data: { roundIndex: 0 } });
    const err = await errP;

    expect(err.message).toBe('Добавьте хотя бы одну команду');
    expect(store.loadState('g').phase).toBe('LOBBY');
  });
});
