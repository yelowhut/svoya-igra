import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { openDb } from '../persistence/db.js';
import { EventStore } from '../persistence/eventStore.js';
import { SessionRegistry } from './session.js';
import { attachGateway, type GatewayDeps } from './gateway.js';
import { makeEvent } from '../domain/events.js';
import { config } from '../config.js';
import { setActiveGame } from '../persistence/activeGameRepo.js';

let teardowns: Array<() => Promise<void>> = [];
let open: Socket[] = [];
afterEach(async () => { open.forEach(s => s.close()); open = []; await Promise.all(teardowns.map(f => f())); teardowns = []; });

function setup(answerTimerSec: number) {
  const db = openDb(':memory:');
  const store = new EventStore(db, 25);
  const pack = { id: 'p', title: 'T', rounds: [{ id: 'r', name: 'R', categories: [{ id: 'c', name: 'C',
    questions: [{ id: 'q1', type: 'text', prompt: 'Q?', answer: 'S', value: 100, special: 'none' }] }] }] };
  db.prepare('INSERT INTO packs (id,data) VALUES (?,?)').run('p', JSON.stringify(pack));
  store.append('g', makeEvent('GAME_CREATED', { gameId: 'g', packId: 'p', title: 'T', teamCount: 2, answerTimerSec, finalAnswerTimerSec: 60 }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'a', name: 'A' }));
  store.append('g', makeEvent('TEAM_CREATED', { teamId: 'b', name: 'B' }));
  store.append('g', makeEvent('ROUND_STARTED', { roundIndex: 0, pickingTeamId: 'a' }));
  store.append('g', makeEvent('QUESTION_SELECTED', { questionId: 'q1', value: 100, special: 'none' }));
  store.append('g', makeEvent('BUZZER_OPENED', {}));
  const httpServer = createServer(); const ioServer = new Server(httpServer);
  const deps: GatewayDeps = { store, db, sessions: new SessionRegistry(), config };
  const gateway = attachGateway(ioServer, deps);
  teardowns.push(() => new Promise<void>(res => { ioServer.close(); httpServer.close(() => res()); }));
  return new Promise<{ url: string; store: EventStore; gateway: ReturnType<typeof attachGateway>; deps: GatewayDeps }>(res => {
    httpServer.listen(() => res({ url: `http://localhost:${(httpServer.address() as any).port}`, store, gateway, deps }));
  });
}

function hostClient(url: string): Promise<Socket> {
  const c = Client(url, { transports: ['websocket'] }); open.push(c);
  return new Promise(res => c.on('connect', () => {
    c.emit('join', { gameId: 'g', firstName: '', lastName: '', clientToken: 'h', role: 'host' });
    res(c);
  }));
}
const states = (c: Socket) => { const buf: any[] = []; c.on('state', s => buf.push(s)); return buf; };

describe('gateway — таймер', () => {
  it('первый базз заводит ANSWER_TIMER_STARTED (answerDeadline в state)', async () => {
    const { url } = await setup(30);
    const h = await hostClient(url); const buf = states(h);
    const player = Client(url, { transports: ['websocket'] }); open.push(player);
    await new Promise<void>(res => player.on('connect', () => { player.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    player.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 150));
    const last = buf[buf.length - 1];
    expect(last.phase).toBe('ANSWERING');
    expect(last.answerDeadline).toBeGreaterThan(Date.now());
  });

  it('timerPause замораживает остаток, timerResume возобновляет', async () => {
    const { url } = await setup(30);
    const h = await hostClient(url); const buf = states(h);
    const p = Client(url, { transports: ['websocket'] }); open.push(p);
    await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    p.emit('playerBuzz', { reaction: 100 });
    await new Promise(r => setTimeout(r, 150));
    h.emit('hostAction', { action: 'timerPause' });
    await new Promise(r => setTimeout(r, 100));
    let last = buf[buf.length - 1];
    expect(last.answerPausedRemainingMs).toBeGreaterThan(0);
    expect(last.answerDeadline).toBeNull();
    h.emit('hostAction', { action: 'timerResume' });
    await new Promise(r => setTimeout(r, 100));
    last = buf[buf.length - 1];
    expect(last.answerDeadline).toBeGreaterThan(Date.now());
    expect(last.answerPausedRemainingMs).toBeNull();
  });

  it('timerReset перезаводит отсчёт на полный номинал', async () => {
    const { url } = await setup(10); // номинал 10 с
    const h = await hostClient(url); const buf = states(h);
    const p = Client(url, { transports: ['websocket'] }); open.push(p);
    await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    p.emit('playerBuzz', { reaction: 100 });
    await new Promise(r => setTimeout(r, 5000)); // прошло ~5 с → остаток ~5 с (БЕЗ сброса)
    h.emit('hostAction', { action: 'timerReset' });
    await new Promise(r => setTimeout(r, 100));
    const last = buf[buf.length - 1];
    expect(last.answerDeadline - Date.now()).toBeGreaterThan(9000); // после сброса снова ~10 с
  }, 15000);

  it('по истечении — ANSWER_TIMED_OUT, ход следующему, новый отсчёт', async () => {
    const { url } = await setup(1); // 1 секунда
    const h = await hostClient(url); const buf = states(h);
    const p = Client(url, { transports: ['websocket'] }); open.push(p);
    await new Promise<void>(res => p.on('connect', () => { p.emit('join', { gameId: 'g', firstName: 'X', lastName: 'Y', teamId: 'a', clientToken: 'p1', role: 'player' }); res(); }));
    // оба забаззили: очередь [a,b]
    p.emit('playerBuzz', { reaction: 100 });
    const p2 = Client(url, { transports: ['websocket'] }); open.push(p2);
    await new Promise<void>(res => p2.on('connect', () => { p2.emit('join', { gameId: 'g', firstName: 'Z', lastName: 'W', teamId: 'b', clientToken: 'p2', role: 'player' }); res(); }));
    p2.emit('playerBuzz', { reaction: 200 });
    await new Promise(r => setTimeout(r, 1300)); // ждём таймаут a
    const last = buf[buf.length - 1];
    expect(last.teams.find((t: any) => t.id === 'a').score).toBe(-100);
    expect(last.answeringTeamId).toBe('b');
    expect(last.answerDeadline).toBeGreaterThan(Date.now()); // новый отсчёт для b
  }, 4000);

  it('recoverAnswerTimers: истёкший дедлайн активной игры → немедленный таймаут', async () => {
    const { url, store, gateway, deps } = await setup(30);
    // Довести до ANSWERING с истёкшим дедлайном вручную
    store.append('g', makeEvent('BUZZ_RECORDED', { teamId: 'a', reaction: 100 }));
    store.append('g', makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() - 1000 })); // уже в прошлом
    // Указать активную игру
    setActiveGame(deps.db, 'g');
    // Подключаем хоста, чтобы видеть state:
    const h = await hostClient(url); const buf = states(h);
    // Эмулировать рестарт: вызвать recoverAnswerTimers
    gateway.recoverAnswerTimers();
    await new Promise(r => setTimeout(r, 200));
    const last = buf[buf.length - 1];
    expect(last.phase).toBe('JUDGED'); // a был единственным валидным → таймаут → JUDGED
  });
});
