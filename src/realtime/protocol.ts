import type { GameState, Pack, Question, Team, BuzzEntry, Phase } from '../domain/types.js';

function findQuestion(pack: Pack, id: string | null): Question | null {
  if (!id) return null;
  for (const r of pack.rounds) for (const c of r.categories) for (const q of c.questions)
    if (q.id === id) return q;
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
  buzzQueue: BuzzEntry[];
  answeringTeamId: string | null;
  currentPrompt: string | null;
  currentType: Question['type'] | null;
  currentMedia: string | null;
  currentValue: number;
}
export interface HostState extends PublicState {
  currentAnswer: string | null;
}

function buildPublic(s: GameState, pack: Pack): PublicState {
  const q = findQuestion(pack, s.currentQuestionId);
  return {
    phase: s.phase, title: s.title, packId: s.packId, teams: s.teams, roundIndex: s.roundIndex,
    usedQuestionIds: s.usedQuestionIds, pickingTeamId: s.pickingTeamId,
    buzzQueue: s.buzzQueue,
    answeringTeamId: s.answeringIndex >= 0 ? s.buzzQueue[s.answeringIndex]?.teamId ?? null : null,
    currentPrompt: q?.prompt ?? null,
    currentType: q?.type ?? null,
    currentMedia: q?.media ?? null,
    currentValue: s.currentValue,
  };
}

export function toPublicState(s: GameState, pack: Pack): PublicState { return buildPublic(s, pack); }
export function toHostState(s: GameState, pack: Pack): HostState {
  const q = findQuestion(pack, s.currentQuestionId);
  return { ...buildPublic(s, pack), currentAnswer: q?.answer ?? null };
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
  goSignal: { serverTime: number };
  blocked: { untilMs: number };
  error: { message: string };
}
