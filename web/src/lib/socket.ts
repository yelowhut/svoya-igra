import { io, type Socket } from 'socket.io-client';
import { get } from 'svelte/store';
import { getClientToken } from './identity.js';
import { gameStore, blockedUntil, buzzSeq, lastError, me } from './store.js';
import { reactionMs } from './buzz.js';

let socket: Socket | null = null;
let current: { gameId: string; role: string } | null = null;

export function connect(): Socket {
  if (socket) return socket;
  socket = io({ reconnection: true, transports: ['websocket'] });
  socket.on('state', s => gameStore.set(s));
  socket.on('goSignal', (s: { greyMs?: number; redMs?: number; yellowMs?: number }) => {
    const t0 = performance.now();
    const grey = s?.greyMs ?? 0, red = s?.redMs ?? 0, yellow = s?.yellowMs ?? 0;
    buzzSeq.set({ redAt: t0 + grey, yellowAt: t0 + grey + red, greenAt: t0 + grey + red + yellow });
  });
  socket.on('blocked', ({ untilMs }: { untilMs: number }) => blockedUntil.set(performance.now() + untilMs));
  socket.on('appError', ({ message }: { message: string }) => lastError.set(message));
  // Игрока выгнали: чистим сохранённую идентичность, чтобы авто-рейджойн не воссоздал игрока,
  // и перезагружаемся — play покажет форму входа (повторный вход возможен как новый игрок). (п.10)
  socket.on('kicked', () => { try { localStorage.removeItem('svoya:player'); } catch { /* ignore */ } location.reload(); });
  socket.on('youAre', (m: any) => me.set(m));
  const rejoin = () => { if (current) socket!.emit('rejoin', { clientToken: getClientToken(current.role) }); };
  socket.on('connect', rejoin);
  window.addEventListener('pageshow', rejoin);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rejoin(); });
  return socket;
}

export function joinAs(gameId: string, role: 'host'|'player'|'board', firstName = '', lastName = '', teamId = '', newTeamName = '') {
  current = { gameId, role };
  connect().emit('join', { gameId, role, firstName, lastName, teamId, newTeamName, clientToken: getClientToken(role) });
}
export function hostAction(action: string, data?: unknown) { connect().emit('hostAction', { action, data }); }
export function finalAction(action: string, data?: unknown) { connect().emit('finalAction', { action, data }); }
export function buzz() {
  const green = get(buzzSeq)?.greenAt ?? performance.now();
  connect().emit('playerBuzz', { reaction: reactionMs(green, performance.now()) });
}
