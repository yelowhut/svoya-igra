import type { Server } from 'socket.io';
import type { EventStore } from '../persistence/eventStore.js';
import type { Db } from '../persistence/db.js';
import type { Config } from '../config.js';
import type { GameState, Pack, Phase } from '../domain/types.js';
import { SessionRegistry, type Role } from './session.js';
import { makeEvent } from '../domain/events.js';
import { toPublicState, toHostState, toPlayerFinalState } from './protocol.js';
import { validateBuzz, computeBlock, f1Schedule } from '../domain/buzzer/buzzer.js';
import { lowestScoreTeamId } from '../domain/engine/rules.js';
import { isValidTeamName } from '../domain/teamName.js';
import { clearActiveGameIfMatches, getActiveGameId } from '../persistence/activeGameRepo.js';
import { answerTimerDecision } from '../domain/engine/answerTimer.js';
import { finalTimerDecision } from '../domain/engine/finalTimer.js';

/** Фазы финала, где игроков рассылаем per-socket (тайна ставок/ответов). */
const FINAL_PER_SOCKET_PHASES = new Set<Phase>([
  'FINAL_INTRO', 'FINAL_ELIMINATION', 'FINAL_BETTING', 'FINAL_QUESTION', 'FINAL_REVEAL',
]);

function playerTeam(state: GameState, playerId: string): string | null {
  return state.players.find(p => p.id === playerId)?.teamId ?? null;
}

/**
 * Валидирует действие игрока финального раунда.
 * Чистая функция — не зависит от side-эффектов.
 *
 * Проверяет:
 * - игрок принадлежит команде;
 * - playerId является капитаном этой команды;
 * - команда есть в eliminationOrder;
 * - фаза соответствует действию;
 * - для removeTheme — это ход данной команды (eliminationOrder[turnIndex]===teamId).
 */
export function validateFinalAction(
  s: GameState,
  action: string,
  playerId: string,
  _data: unknown,
): { ok: true; teamId: string } | { ok: false } {
  if (!s.final) return { ok: false };

  // найти команду игрока
  const player = s.players.find(p => p.id === playerId);
  if (!player) return { ok: false };
  const teamId = player.teamId;

  // проверить, что playerId — капитан этой команды
  const team = s.teams.find(t => t.id === teamId);
  if (!team || team.captainPlayerId !== playerId) return { ok: false };

  // команда должна быть в eliminationOrder
  if (!s.final.eliminationOrder.includes(teamId)) return { ok: false };

  // проверка фазы и хода
  switch (action) {
    case 'removeTheme':
      if (s.phase !== 'FINAL_ELIMINATION') return { ok: false };
      // ход этой команды
      if (s.final.eliminationOrder[s.final.eliminationTurnIndex] !== teamId) return { ok: false };
      break;
    case 'placeBet':
      if (s.phase !== 'FINAL_BETTING') return { ok: false };
      break;
    case 'updateAnswer':
    case 'lockAnswer':
      if (s.phase !== 'FINAL_QUESTION') return { ok: false };
      break;
    default:
      return { ok: false };
  }

  return { ok: true, teamId };
}

export interface GatewayDeps { store: EventStore; db: Db; sessions: SessionRegistry; config: Config; }

export function loadPack(db: Db, packId: string): Pack {
  const row = db.prepare('SELECT data FROM packs WHERE id = ?').get(packId) as { data: string } | undefined;
  if (!row) throw new Error('пак не найден');
  return JSON.parse(row.data) as Pack;
}

export function broadcastState(io: Server, deps: GatewayDeps, gameId: string): void {
  const state = deps.store.loadState(gameId);
  // Пак мог быть удалён (снят с публикации), а игра на него ещё ссылается —
  // не валим весь join из-за отсутствующего пака: шлём состояние без вопросов.
  let pack: Pack | null = null;
  try { pack = loadPack(deps.db, state.packId); } catch { pack = null; }

  // board и host — всегда через room
  io.to(`game:${gameId}:board`).emit('state', toPublicState(state, pack));
  io.to(`game:${gameId}:host`).emit('state', toHostState(state, pack));

  if (FINAL_PER_SOCKET_PHASES.has(state.phase)) {
    // Финал-фазы: рассылаем игрокам per-socket, чтобы каждый видел только свои ставку/ответ
    for (const sess of deps.sessions.all()) {
      if (sess.gameId === gameId && sess.role === 'player' && sess.socketId != null) {
        const team = state.players.find(p => p.id === sess.playerId);
        const viewerTeamId = team?.teamId ?? null;
        io.to(sess.socketId).emit('state', toPlayerFinalState(state, pack, viewerTeamId));
      }
    }
  } else {
    // Обычная рассылка
    io.to(`game:${gameId}:player`).emit('state', toPublicState(state, pack));
  }
}

export function attachGateway(io: Server, deps: GatewayDeps): { recoverAnswerTimers: () => void } {
  const offenseCount = new Map<string, number>();
  const answerTimers = new Map<string, { timeout: ReturnType<typeof setTimeout>; deadline: number }>();

  function clearAnswerTimer(gameId: string): void {
    const t = answerTimers.get(gameId);
    if (t) { clearTimeout(t.timeout); answerTimers.delete(gameId); }
  }

  const finalTimers = new Map<string, { timeout: ReturnType<typeof setTimeout>; deadline: number }>();

  function clearFinalTimer(gameId: string): void {
    const e = finalTimers.get(gameId);
    if (e) { clearTimeout(e.timeout); finalTimers.delete(gameId); }
  }

  function syncFinalTimer(gameId: string): void {
    const s = deps.store.loadState(gameId);
    const d = finalTimerDecision(s, Date.now());
    switch (d.kind) {
      case 'clear': clearFinalTimer(gameId); return;
      case 'start':
        deps.store.append(gameId, makeEvent('FINAL_TIMER_STARTED', { deadline: Date.now() + s.finalAnswerTimerSec * 1000 }));
        broadcastState(io, deps, gameId); syncFinalTimer(gameId); return;
      case 'timeout':
        deps.store.append(gameId, makeEvent('FINAL_TIMED_OUT', {}));
        broadcastState(io, deps, gameId); syncFinalTimer(gameId); return;
      case 'arm': {
        const existing = finalTimers.get(gameId);
        if (existing && existing.deadline === s.final!.answerDeadline) return;
        if (existing) clearTimeout(existing.timeout);
        const timeout = setTimeout(() => { finalTimers.delete(gameId); syncFinalTimer(gameId); }, d.delayMs);
        finalTimers.set(gameId, { timeout, deadline: s.final!.answerDeadline! });
        return;
      }
    }
  }

  function syncAnswerTimer(gameId: string): void {
    const s = deps.store.loadState(gameId);
    const d = answerTimerDecision(s, Date.now());
    switch (d.kind) {
      case 'clear': clearAnswerTimer(gameId); return;
      case 'noop': return;
      case 'start':
        deps.store.append(gameId, makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() + s.answerTimerSec * 1000 }));
        broadcastState(io, deps, gameId); syncAnswerTimer(gameId); return;
      case 'timeout':
        deps.store.append(gameId, makeEvent('ANSWER_TIMED_OUT', { teamId: d.teamId }));
        broadcastState(io, deps, gameId); syncAnswerTimer(gameId); return;
      case 'arm': {
        const existing = answerTimers.get(gameId);
        if (existing && existing.deadline === s.answerDeadline) return; // уже взведён под этот дедлайн
        if (existing) clearTimeout(existing.timeout);
        const timeout = setTimeout(() => { answerTimers.delete(gameId); syncAnswerTimer(gameId); }, d.delayMs);
        answerTimers.set(gameId, { timeout, deadline: s.answerDeadline! });
        return;
      }
    }
  }

  io.on('connection', (socket) => {
    let joinedGame: string | null = null;

    socket.on('join', (p: { gameId: string; firstName: string; lastName: string; teamId?: string; newTeamName?: string; clientToken: string; role: Role }) => {
      const playerId = crypto.randomUUID();
      let effectiveTeamId: string | undefined;

      if (p.role === 'player') {
        const existingState = deps.store.loadState(p.gameId);
        const existing = existingState.players.find(pl => pl.clientToken === p.clientToken);
        if (existing) {
          // reclaim: re-bind session to the existing player, mark connected, join rooms, broadcast
          deps.sessions.bind(p.clientToken, socket.id, existing.id, 'player', p.gameId);
          joinedGame = p.gameId;
          socket.join(`game:${p.gameId}`);
          socket.join(`game:${p.gameId}:player`);
          deps.store.append(p.gameId, makeEvent('PLAYER_CONNECTED', { playerId: existing.id }));
          socket.emit('youAre', { playerId: existing.id, teamId: existing.teamId, role: 'player' });
          broadcastState(io, deps, p.gameId);
          return;
        }
        if (p.newTeamName && p.newTeamName.trim() !== '') {
          // Validate and create new team
          if (!isValidTeamName(p.newTeamName)) {
            socket.emit('appError', { message: 'Недопустимое имя команды' });
            return;
          }
          const newTeamId = crypto.randomUUID();
          deps.store.append(p.gameId, makeEvent('TEAM_CREATED', { teamId: newTeamId, name: p.newTeamName.trim() }));
          effectiveTeamId = newTeamId;
        } else if (p.teamId) {
          if (!existingState.teams.some(t => t.id === p.teamId)) {
            socket.emit('appError', { message: 'Команда не найдена' }); return;
          }
          effectiveTeamId = p.teamId;
        } else {
          socket.emit('appError', { message: 'Выберите или создайте команду' });
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
          if (st.teams.length === 0) { socket.emit('appError', { message: 'Добавьте хотя бы одну команду' }); return; }
          deps.store.append(gid, makeEvent('ROUND_STARTED', { roundIndex: d.roundIndex, pickingTeamId: lowestScoreTeamId(st.teams) }));
          break;
        case 'selectQuestion':
          offenseCount.clear(); // новый вопрос — сбрасываем эскалацию микроблока
          deps.store.append(gid, makeEvent('QUESTION_SELECTED', { questionId: d.questionId, value: d.value, special: d.special }));
          break;
        case 'reveal': deps.store.append(gid, makeEvent('QUESTION_REVEALED', {})); break;
        case 'arm': deps.store.append(gid, makeEvent('BUZZER_ARMED', {})); break;
        case 'open':
          deps.store.append(gid, makeEvent('BUZZER_OPENED', {}));
          // Стартовые огни F1: случайное расписание (одно на всех — зелёный синхронен)
          io.to(`game:${gid}`).emit('goSignal', { serverTime: Date.now(), ...f1Schedule(Math.random) });
          break;
        case 'startAnswers': deps.store.append(gid, makeEvent('ANSWERS_STARTED', {})); break;
        case 'resetRound': deps.store.append(gid, makeEvent('ROUND_RESET', {})); break;
        case 'judge': deps.store.append(gid, makeEvent('ANSWER_JUDGED', { teamId: d.teamId, correct: d.correct, value: st.currentValue })); break;
        case 'closeQuestion': deps.store.append(gid, makeEvent('QUESTION_CLOSED', {})); break;
        case 'auctionBid': deps.store.append(gid, makeEvent('AUCTION_BID', { teamId: d.teamId, amount: d.amount })); break;
        case 'auctionWon': deps.store.append(gid, makeEvent('AUCTION_WON', { teamId: d.teamId, amount: d.amount })); break;
        case 'catAssign': deps.store.append(gid, makeEvent('CAT_ASSIGNED', { toTeamId: d.toTeamId })); break;
        case 'adjustScore': deps.store.append(gid, makeEvent('SCORE_ADJUSTED', { teamId: d.teamId, delta: d.delta })); break;
        case 'endRound': deps.store.append(gid, makeEvent('ROUND_ENDED', {})); break;
        case 'endGame':
          deps.store.append(gid, makeEvent('GAME_ENDED', {}));
          clearActiveGameIfMatches(deps.db, gid);
          break;
        case 'createTeam':
          if (!isValidTeamName(d.name)) { socket.emit('appError', { message: 'Недопустимое имя команды' }); return; }
          deps.store.append(gid, makeEvent('TEAM_CREATED', { teamId: crypto.randomUUID(), name: d.name.trim() }));
          break;
        case 'renameTeam':
          if (!isValidTeamName(d.name)) { socket.emit('appError', { message: 'Недопустимое имя команды' }); return; }
          deps.store.append(gid, makeEvent('TEAM_RENAMED', { teamId: d.teamId, name: d.name.trim() }));
          break;
        case 'deleteTeam': {
          const hasPlayers = st.players.some(p => p.teamId === d.teamId);
          if (hasPlayers) { socket.emit('appError', { message: 'Нельзя удалить команду с игроками' }); return; }
          deps.store.append(gid, makeEvent('TEAM_DELETED', { teamId: d.teamId }));
          break;
        }
        case 'movePlayer':
          if (!st.teams.some(t => t.id === d.teamId)) { socket.emit('appError', { message: 'Команда не найдена' }); return; }
          deps.store.append(gid, makeEvent('PLAYER_MOVED', { playerId: d.playerId, teamId: d.teamId }));
          break;
        case 'kickPlayer': {
          const pid = d.playerId;
          if (!st.players.some(p => p.id === pid)) return;
          // отключить открытые сокеты игрока + сказать клиенту очиститься
          for (const sess of deps.sessions.all()) {
            if (sess.gameId === gid && sess.playerId === pid && sess.socketId) {
              io.to(sess.socketId).emit('kicked', {});
              io.sockets.sockets.get(sess.socketId)?.disconnect(true);
            }
          }
          deps.store.append(gid, makeEvent('PLAYER_KICKED', { playerId: pid }));
          break;
        }
        case 'timerPause':
          if (st.phase === 'ANSWERING' && st.answerDeadline != null) {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_PAUSED', { remainingMs: Math.max(0, st.answerDeadline - Date.now()) }));
          }
          break;
        case 'timerResume':
          if (st.phase === 'ANSWERING' && st.answerPausedRemainingMs != null) {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_RESUMED', { deadline: Date.now() + st.answerPausedRemainingMs }));
          }
          break;
        case 'timerReset':
          if (st.phase === 'ANSWERING') {
            deps.store.append(gid, makeEvent('ANSWER_TIMER_STARTED', { deadline: Date.now() + st.answerTimerSec * 1000 }));
          }
          break;

        // ── Финальный раунд ──────────────────────────────────────────────
        case 'startFinal': {
          const pack = loadPack(deps.db, st.packId);
          const finalRound = pack.rounds.find(r => r.type === 'final') as import('../domain/types.js').FinalRound | undefined;
          if (!finalRound) { socket.emit('appError', { message: 'Финальный раунд не найден в паке' }); return; }
          // Назначить капитанов для участвующих команд без капитана
          for (const team of st.teams) {
            if (team.score > 0 && team.captainPlayerId === null) {
              const candidate = st.players.find(p => p.teamId === team.id && p.connected);
              if (candidate) {
                deps.store.append(gid, makeEvent('CAPTAIN_ASSIGNED', { teamId: team.id, playerId: candidate.id }));
              }
            }
          }
          deps.store.append(gid, makeEvent('FINAL_STARTED', { themeIds: finalRound.themes.map(t => t.id) }));
          break;
        }
        case 'assignCaptain': {
          const player = st.players.find(p => p.id === d.playerId);
          if (!player || player.teamId !== d.teamId) { socket.emit('appError', { message: 'Игрок не входит в эту команду' }); return; }
          deps.store.append(gid, makeEvent('CAPTAIN_ASSIGNED', { teamId: d.teamId, playerId: d.playerId }));
          break;
        }
        case 'finalBeginElimination':
          deps.store.append(gid, makeEvent('FINAL_ELIMINATION_BEGAN', {}));
          break;
        case 'finalJudge':
          deps.store.append(gid, makeEvent('FINAL_ANSWER_JUDGED', { teamId: d.teamId, correct: d.correct }));
          break;
        case 'finalTimerPause': {
          const remaining = st.final?.answerDeadline != null ? Math.max(0, st.final.answerDeadline - Date.now()) : 0;
          deps.store.append(gid, makeEvent('FINAL_TIMER_PAUSED', { remainingMs: remaining }));
          break;
        }
        case 'finalTimerResume':
          if (st.final?.answerPausedRemainingMs != null) {
            deps.store.append(gid, makeEvent('FINAL_TIMER_RESUMED', { deadline: Date.now() + st.final.answerPausedRemainingMs }));
          }
          break;
        case 'finalTimerReset':
          deps.store.append(gid, makeEvent('FINAL_TIMER_RESUMED', { deadline: Date.now() + st.finalAnswerTimerSec * 1000 }));
          break;

        default: return;
      }
      broadcastState(io, deps, gid);
      syncAnswerTimer(gid);
      syncFinalTimer(gid);
    });

    socket.on('playerBuzz', (msg: { reaction: number }) => {
      if (!joinedGame) return;
      const session = deps.sessions.bySocket(socket.id);
      if (!session) return;
      const st = deps.store.loadState(joinedGame);
      const teamId = playerTeam(st, session.playerId);
      if (!teamId) return;
      const blockPlayer = () => {
        const prev = offenseCount.get(session.playerId) ?? 0;
        const untilMs = computeBlock(prev, Math.random);
        offenseCount.set(session.playerId, prev + 1);
        socket.emit('blocked', { untilMs });
      };
      // Приём только в окне баззера (серый/Приготовиться — клиент не шлёт; вне окна — игнор).
      if (st.phase !== 'BUZZER_OPEN' && st.phase !== 'ANSWERING') return;
      // Фальстарт = нажатие до «зелёного» (reaction < 0, во время отсчёта огней).
      if (validateBuzz(msg.reaction) === 'falsestart') { blockPlayer(); return; }
      deps.store.append(joinedGame, makeEvent('BUZZ_RECORDED', { teamId, reaction: msg.reaction }));
      broadcastState(io, deps, joinedGame);
      syncAnswerTimer(joinedGame);
    });

    socket.on('finalAction', (msg: { action: string; data?: unknown }) => {
      if (!joinedGame) return;
      const sess = deps.sessions.bySocket(socket.id);
      if (!sess || sess.role !== 'player') return;
      const gid = joinedGame;
      const st = deps.store.loadState(gid);
      const result = validateFinalAction(st, msg.action, sess.playerId, msg.data ?? {});
      if (!result.ok) return;
      const { teamId } = result;
      const d = (msg.data ?? {}) as Record<string, unknown>;

      switch (msg.action) {
        case 'removeTheme':
          deps.store.append(gid, makeEvent('FINAL_THEME_REMOVED', { themeId: d.themeId as string, byTeamId: teamId }));
          break;
        case 'placeBet': {
          // клампим ставку в диапазон 0..score команды
          const rawAmount = typeof d.amount === 'number' ? d.amount : 0;
          const team = st.teams.find(t => t.id === teamId);
          const maxScore = team?.score ?? 0;
          const amount = Math.max(0, Math.min(rawAmount, maxScore));
          deps.store.append(gid, makeEvent('FINAL_BET_PLACED', { teamId, amount }));
          break;
        }
        case 'updateAnswer':
          deps.store.append(gid, makeEvent('FINAL_ANSWER_UPDATED', { teamId, text: (d.text as string) ?? '' }));
          break;
        case 'lockAnswer':
          deps.store.append(gid, makeEvent('FINAL_ANSWER_LOCKED', { teamId }));
          break;
        default:
          return;
      }
      broadcastState(io, deps, gid);
      syncFinalTimer(gid);
    });
  });

  return {
    recoverAnswerTimers() {
      const gid = getActiveGameId(deps.db);
      if (gid) { syncAnswerTimer(gid); syncFinalTimer(gid); }
    },
  };
}
