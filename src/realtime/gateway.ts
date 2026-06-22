import type { Server } from 'socket.io';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import type { Pack } from '../domain/types.js';
import { SessionRegistry, type Role } from './session.js';
import { makeEvent } from '../domain/events.js';
import { toPublicState, toHostState } from './protocol.js';

export interface GatewayDeps { store: EventStore; db: Db; sessions: SessionRegistry; config: Config; }

export function loadPack(db: Db, packId: string): Pack {
  const row = db.prepare('SELECT data FROM packs WHERE id = ?').get(packId) as { data: string } | undefined;
  if (!row) throw new Error('пак не найден');
  return JSON.parse(row.data) as Pack;
}

export function broadcastState(io: Server, deps: GatewayDeps, gameId: string): void {
  const state = deps.store.loadState(gameId);
  const pack = loadPack(deps.db, state.packId);
  io.to(`game:${gameId}:player`).emit('state', toPublicState(state, pack));
  io.to(`game:${gameId}:board`).emit('state', toPublicState(state, pack));
  io.to(`game:${gameId}:host`).emit('state', toHostState(state, pack));
}

export function attachGateway(io: Server, deps: GatewayDeps): void {
  io.on('connection', (socket) => {
    let joinedGame: string | null = null;

    socket.on('join', (p: { gameId: string; firstName: string; lastName: string; teamId: string; clientToken: string; role: Role }) => {
      joinedGame = p.gameId;
      const playerId = crypto.randomUUID();
      if (p.role === 'player') {
        deps.store.append(p.gameId, makeEvent('PLAYER_JOINED', {
          playerId, clientToken: p.clientToken, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId,
        }));
      }
      deps.sessions.bind(p.clientToken, socket.id, playerId, p.role);
      socket.join(`game:${p.gameId}`);
      socket.join(`game:${p.gameId}:${p.role}`);
      socket.emit('youAre', { playerId, teamId: p.teamId, role: p.role });
      broadcastState(io, deps, p.gameId);
    });

    socket.on('disconnect', () => {
      const s = deps.sessions.markDisconnected(socket.id);
      if (s && joinedGame && s.role === 'player') {
        deps.store.append(joinedGame, makeEvent('PLAYER_DISCONNECTED', { playerId: s.playerId }));
        broadcastState(io, deps, joinedGame);
      }
    });
  });
}
