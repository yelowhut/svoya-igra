import type { Server } from 'socket.io';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import type { GameState, Pack } from '../domain/types.js';
import { SessionRegistry, type Role } from './session.js';
import { makeEvent } from '../domain/events.js';
import { toPublicState, toHostState } from './protocol.js';
import { validateBuzz, computeBlock } from '../domain/buzzer/buzzer.js';
import { lowestScoreTeamId } from '../domain/engine/rules.js';
import { isValidTeamName } from '../domain/teamName.js';

function playerTeam(state: GameState, playerId: string): string | null {
  return state.players.find(p => p.id === playerId)?.teamId ?? null;
}

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
  const offenseCount = new Map<string, number>();

  io.on('connection', (socket) => {
    let joinedGame: string | null = null;

    socket.on('join', (p: { gameId: string; firstName: string; lastName: string; teamId?: string; newTeamName?: string; clientToken: string; role: Role }) => {
      const playerId = crypto.randomUUID();
      let effectiveTeamId: string | undefined;

      if (p.role === 'player') {
        if (p.newTeamName && p.newTeamName.trim() !== '') {
          // Validate and create new team
          if (!isValidTeamName(p.newTeamName)) {
            socket.emit('error', { message: 'Недопустимое имя команды' });
            return;
          }
          const newTeamId = crypto.randomUUID();
          deps.store.append(p.gameId, makeEvent('TEAM_CREATED', { teamId: newTeamId, name: p.newTeamName.trim() }));
          effectiveTeamId = newTeamId;
        } else if (p.teamId) {
          effectiveTeamId = p.teamId;
        } else {
          socket.emit('error', { message: 'Выберите или создайте команду' });
          return;
        }
        deps.store.append(p.gameId, makeEvent('PLAYER_JOINED', {
          playerId, clientToken: p.clientToken, firstName: p.firstName, lastName: p.lastName, teamId: effectiveTeamId,
        }));
      }

      joinedGame = p.gameId;
      deps.sessions.bind(p.clientToken, socket.id, playerId, p.role, p.gameId);
      socket.join(`game:${p.gameId}`);
      socket.join(`game:${p.gameId}:${p.role}`);
      socket.emit('youAre', { playerId, teamId: effectiveTeamId ?? p.teamId, role: p.role });
      broadcastState(io, deps, p.gameId);
    });

    socket.on('rejoin', (p: { clientToken: string }) => {
      const s = deps.sessions.byToken(p.clientToken);
      if (!s) return;
      deps.sessions.bind(p.clientToken, socket.id, s.playerId, s.role);
      if (s.gameId) {
        joinedGame = s.gameId;
        socket.join(`game:${s.gameId}`);
        socket.join(`game:${s.gameId}:${s.role}`);
        deps.store.append(s.gameId, makeEvent('PLAYER_CONNECTED', { playerId: s.playerId }));
        broadcastState(io, deps, s.gameId);
      }
    });

    socket.on('disconnect', () => {
      const s = deps.sessions.markDisconnected(socket.id);
      if (s && joinedGame && s.role === 'player') {
        deps.store.append(joinedGame, makeEvent('PLAYER_DISCONNECTED', { playerId: s.playerId }));
        broadcastState(io, deps, joinedGame);
      }
    });

    socket.on('hostAction', (msg: { action: string; data?: any }) => {
      if (!joinedGame) return;
      const sess = deps.sessions.bySocket(socket.id);
      if (!sess || sess.role !== 'host') return;
      const gid = joinedGame;
      const st = deps.store.loadState(gid);
      const d = msg.data ?? {};
      switch (msg.action) {
        case 'startGame': deps.store.append(gid, makeEvent('GAME_STARTED', {})); break;
        case 'startRound':
          deps.store.append(gid, makeEvent('ROUND_STARTED', { roundIndex: d.roundIndex, pickingTeamId: lowestScoreTeamId(st.teams) }));
          break;
        case 'selectQuestion':
          deps.store.append(gid, makeEvent('QUESTION_SELECTED', { questionId: d.questionId, value: d.value, special: d.special }));
          break;
        case 'arm': deps.store.append(gid, makeEvent('BUZZER_ARMED', {})); break;
        case 'open':
          deps.store.append(gid, makeEvent('BUZZER_OPENED', {}));
          io.to(`game:${gid}`).emit('goSignal', { serverTime: Date.now() });
          break;
        case 'judge': deps.store.append(gid, makeEvent('ANSWER_JUDGED', { teamId: d.teamId, correct: d.correct, value: st.currentValue })); break;
        case 'closeQuestion': deps.store.append(gid, makeEvent('QUESTION_CLOSED', {})); break;
        case 'auctionBid': deps.store.append(gid, makeEvent('AUCTION_BID', { teamId: d.teamId, amount: d.amount })); break;
        case 'auctionWon': deps.store.append(gid, makeEvent('AUCTION_WON', { teamId: d.teamId, amount: d.amount })); break;
        case 'catAssign': deps.store.append(gid, makeEvent('CAT_ASSIGNED', { toTeamId: d.toTeamId })); break;
        case 'adjustScore': deps.store.append(gid, makeEvent('SCORE_ADJUSTED', { teamId: d.teamId, delta: d.delta })); break;
        case 'endRound': deps.store.append(gid, makeEvent('ROUND_ENDED', {})); break;
        case 'endGame': deps.store.append(gid, makeEvent('GAME_ENDED', {})); break;
        case 'createTeam':
          if (!isValidTeamName(d.name)) { socket.emit('error', { message: 'Недопустимое имя команды' }); return; }
          deps.store.append(gid, makeEvent('TEAM_CREATED', { teamId: crypto.randomUUID(), name: d.name.trim() }));
          break;
        case 'renameTeam':
          if (!isValidTeamName(d.name)) { socket.emit('error', { message: 'Недопустимое имя команды' }); return; }
          deps.store.append(gid, makeEvent('TEAM_RENAMED', { teamId: d.teamId, name: d.name.trim() }));
          break;
        case 'deleteTeam': {
          const hasPlayers = st.players.some(p => p.teamId === d.teamId);
          if (hasPlayers) { socket.emit('error', { message: 'Нельзя удалить команду с игроками' }); return; }
          deps.store.append(gid, makeEvent('TEAM_DELETED', { teamId: d.teamId }));
          break;
        }
        case 'movePlayer':
          deps.store.append(gid, makeEvent('PLAYER_MOVED', { playerId: d.playerId, teamId: d.teamId }));
          break;
        default: return;
      }
      broadcastState(io, deps, gid);
    });

    socket.on('playerBuzz', (msg: { reaction: number }) => {
      if (!joinedGame) return;
      const session = deps.sessions.bySocket(socket.id);
      if (!session) return;
      const st = deps.store.loadState(joinedGame);
      const teamId = playerTeam(st, session.playerId);
      if (!teamId) return;
      if (validateBuzz(msg.reaction, deps.config.minReactionMs) === 'falsestart') {
        const prev = offenseCount.get(session.playerId) ?? 0;
        const untilMs = computeBlock(prev, deps.config.blockMinMs, deps.config.blockMaxMs, Math.random);
        offenseCount.set(session.playerId, prev + 1);
        socket.emit('blocked', { untilMs });
        return;
      }
      deps.store.append(joinedGame, makeEvent('BUZZ_RECORDED', { teamId, reaction: msg.reaction }));
      broadcastState(io, deps, joinedGame);
    });
  });
}
