import type { GameState, Pack, Question, Team, BuzzEntry, Phase, SpecialType, AuctionState, ScoreLogEntry } from '../domain/types.js';

function findQuestion(pack: Pack | null, id: string | null): Question | null {
  if (!id || !pack) return null;
  for (const r of pack.rounds) {
    const questions = r.type === 'final'
      ? r.themes.map(t => t.question)
      : r.categories.flatMap(c => c.questions);
    for (const q of questions) if (q.id === id) return q;
  }
  return null;
}

export interface PublicState {
  phase: Phase;
  title: string;
  packId: string;
  teams: Team[];
  roundIndex: number;
  usedQuestionIds: string[];
  pickingTeamId: string | null;
  currentQuestionId: string | null;   // для подсветки выбранной клетки на табло/пульте
  revealed: boolean;                   // прочитан ли вопрос (игрокам/табло)
  buzzQueue: BuzzEntry[];
  answeringTeamId: string | null;
  currentPrompt: string | null;
  currentType: Question['type'] | null;
  currentMedia: string | null;
  currentValue: number;
  currentSpecial: SpecialType | null;
  auction: AuctionState | null;
  assignedTeamId: string | null;
  questionResults: Record<string, { correct: boolean; delta: number }>;
  roundScoreLog: ScoreLogEntry[];
  answerTimerSec: number;
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
  serverNow: number;
}
export interface HostState extends PublicState {
  currentAnswer: string | null;
  players: Array<{ id: string; firstName: string; lastName: string; teamId: string; connected: boolean }>;
}

function buildPublic(s: GameState, pack: Pack | null, now: number): PublicState {
  // Игрокам и табло вопрос виден только после «Прочитать вопрос» (revealed).
  const q = s.revealed ? findQuestion(pack, s.currentQuestionId) : null;
  return {
    phase: s.phase, title: s.title, packId: s.packId, teams: s.teams, roundIndex: s.roundIndex,
    usedQuestionIds: s.usedQuestionIds, pickingTeamId: s.pickingTeamId,
    currentQuestionId: s.currentQuestionId, revealed: s.revealed,
    buzzQueue: s.buzzQueue,
    answeringTeamId: s.phase === 'ANSWERING' && s.answeringIndex >= 0
      ? s.buzzQueue[s.answeringIndex]?.teamId ?? null : null,
    currentPrompt: q?.prompt ?? null,
    currentType: q?.type ?? null,
    currentMedia: q?.media?.replace(/^media\//, '') ?? null,
    currentValue: s.currentValue,
    currentSpecial: q?.special ?? null,
    auction: s.auction,
    assignedTeamId: s.assignedTeamId,
    questionResults: s.questionResults,
    roundScoreLog: s.roundScoreLog,
    answerTimerSec: s.answerTimerSec,
    answerDeadline: s.answerDeadline,
    answerPausedRemainingMs: s.answerPausedRemainingMs,
    serverNow: now,
  };
}

export function toPublicState(s: GameState, pack: Pack | null, now: number = Date.now()): PublicState { return buildPublic(s, pack, now); }
export function toHostState(s: GameState, pack: Pack | null, now: number = Date.now()): HostState {
  // Ведущий видит вопрос и ответ ВСЕГДА (даже до «Прочитать вопрос»), чтобы прочитать вслух.
  const q = findQuestion(pack, s.currentQuestionId);
  return {
    ...buildPublic(s, pack, now),
    currentPrompt: q?.prompt ?? null,
    currentType: q?.type ?? null,
    currentMedia: q?.media?.replace(/^media\//, '') ?? null,
    currentSpecial: q?.special ?? null,
    currentAnswer: q?.answer ?? null,
    players: s.players.map(({ id, firstName, lastName, teamId, connected }) => ({ id, firstName, lastName, teamId, connected })),
  };
}

// Контракты сообщений (используются клиентом и gateway)
export interface ClientToServer {
  join: { gameId: string; firstName: string; lastName: string; teamId: string; clientToken: string };
  rejoin: { clientToken: string };
  createTeam: { name: string };
  hostAction: { action: string; data?: unknown };
  playerBuzz: { reaction: number };
}
export interface ServerToClient {
  state: PublicState | HostState;
  youAre: { playerId: string; teamId: string; role: 'host' | 'player' | 'board' };
  goSignal: { serverTime: number; greyMs: number; redMs: number; yellowMs: number };
  blocked: { untilMs: number };
  appError: { message: string };
}
