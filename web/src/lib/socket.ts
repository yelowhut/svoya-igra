import { io, type Socket } from 'socket.io-client';
import { getClientToken } from './identity.js';
import { gameStore, blockedUntil, goReceivedAt, lastError } from './store.js';
import { reactionMs } from './buzz.js';

let socket: Socket | null = null;
let current: { gameId: string; role: string } | null = null;

export function connect(): Socket {
  if (socket) return socket;
  socket = io({ reconnection: true, transports: ['websocket'] });
  socket.on('state', s => gameStore.set(s));
  socket.on('goSignal', () => goReceivedAt.set(performance.now()));
  socket.on('blocked', ({ untilMs }: { untilMs: number }) => blockedUntil.set(performance.now() + untilMs));
  socket.on('appError', ({ message }: { message: string }) => lastError.set(message));
  const rejoin = () => { if (current) socket!.emit('rejoin', { clientToken: getClientToken() }); };
  socket.on('connect', rejoin);
  window.addEventListener('pageshow', rejoin);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rejoin(); });
  return socket;
}

export function joinAs(gameId: string, role: 'host'|'player'|'board', firstName = '', lastName = '', teamId = '', newTeamName = '') {
  current = { gameId, role };
  connect().emit('join', { gameId, role, firstName, lastName, teamId, newTeamName, clientToken: getClientToken() });
}
export function hostAction(action: string, data?: unknown) { connect().emit('hostAction', { action, data }); }
export function buzz() {
  let go = 0; goReceivedAt.subscribe(v => go = v)();
  connect().emit('playerBuzz', { reaction: reactionMs(go, performance.now()) });
}
