import type { GameState, Pack, Question, Team, BuzzEntry, Phase, SpecialType, AuctionState, ScoreLogEntry, FinalRound } from '../domain/types.js';

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

/** Возвращает финал-раунд из пака (если есть). */
function finalRound(pack: Pack | null): FinalRound | undefined {
  return pack?.rounds.find(r => r.type === 'final') as FinalRound | undefined;
}

/** Возвращает оставшуюся тему (когда themeIds.length===1). */
function remainingTheme(s: GameState, pack: Pack | null) {
  if (!s.final || s.final.themeIds.length !== 1) return undefined;
  return finalRound(pack)?.themes.find(t => t.id === s.final!.themeIds[0]);
}

/** Фазы, в которых показывается финал-вопрос оставшейся темы. */
const FINAL_QUESTION_PHASES: ReadonlySet<Phase> = new Set(['FINAL_QUESTION', 'FINAL_REVEAL', 'GAME_END']);
/** Фазы, в которых s.final != null (финал активен). */
const FINAL_ACTIVE_PHASES: ReadonlySet<Phase> = new Set([
  'FINAL_INTRO', 'FINAL_ELIMINATION', 'FINAL_BETTING', 'FINAL_QUESTION', 'FINAL_REVEAL', 'GAME_END',
]);

export interface FinalPublicBlock {
  themeIds: string[];
  eliminationOrder: string[];
  eliminationTurnIndex: number;
  betPlaced: string[];
  answerLocked: string[];
  bets: Record<string, number>;
  answers: Record<string, { text: string; locked: boolean }>;
  verdicts: Record<string, boolean>;   // teamId -> верно/неверно, виден только на reveal (п.11)
  revealIndex: number;
  answerTimerSec: number;
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
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
  roster: Array<{ firstName: string; lastName: string; teamId: string; connected: boolean }>;  // состав команд для табло
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
  captains: Record<string, string | null>;
  final: FinalPublicBlock | null;
  finalThemes: Array<{ id: string; name: string }> | null;
  finalQuestion: { type: Question['type']; prompt: string; media: string | null } | null;
}
export interface HostState extends PublicState {
  currentAnswer: string | null;
  players: Array<{ id: string; firstName: string; lastName: string; teamId: string; connected: boolean }>;
  finalReferenceAnswer: string | null;
}

/** Строит финал-блок с маскировкой тайны. viewerTeamId=null → answers={} до reveal (board/host). */
function buildFinalBlock(
  s: GameState,
  viewerTeamId: string | null,
): FinalPublicBlock | null {
  if (!s.final) return null;
  const f = s.final;
  const reveal = s.phase === 'FINAL_REVEAL' || s.phase === 'GAME_END';

  const bets: Record<string, number> = reveal ? f.bets : {};

  let answers: Record<string, { text: string; locked: boolean }>;
  if (reveal) {
    answers = f.answers;
  } else if (viewerTeamId && f.answers[viewerTeamId]) {
    answers = { [viewerTeamId]: f.answers[viewerTeamId] };
  } else {
    answers = {};
  }

  return {
    themeIds: f.themeIds,
    eliminationOrder: f.eliminationOrder,
    eliminationTurnIndex: f.eliminationTurnIndex,
    betPlaced: Object.keys(f.bets),
    answerLocked: Object.entries(f.answers).filter(([, a]) => a.locked).map(([t]) => t),
    bets,
    answers,
    // Вердикты отдаём только на reveal (клиент рисует только вскрытые строки idx<revealIndex). (п.11)
    verdicts: reveal ? (f.verdicts ?? {}) : {},
    revealIndex: f.revealIndex,
    answerTimerSec: s.finalAnswerTimerSec,
    answerDeadline: f.answerDeadline,
    answerPausedRemainingMs: f.answerPausedRemainingMs,
  };
}

function buildPublic(s: GameState, pack: Pack | null, now: number, viewerTeamId: string | null): PublicState {
  // Игрокам и табло вопрос виден только после «Прочитать вопрос» (revealed).
  const q = s.revealed ? findQuestion(pack, s.currentQuestionId) : null;

  const fr = finalRound(pack);
  const finalThemes = FINAL_ACTIVE_PHASES.has(s.phase) && fr
    ? fr.themes.map(t => ({ id: t.id, name: t.name }))
    : null;

  const remTheme = FINAL_QUESTION_PHASES.has(s.phase) ? remainingTheme(s, pack) : undefined;
  const finalQuestion = remTheme
    ? { type: remTheme.question.type, prompt: remTheme.question.prompt, media: remTheme.question.media?.replace(/^media\//, '') ?? null }
    : null;

  const final = FINAL_ACTIVE_PHASES.has(s.phase) ? buildFinalBlock(s, viewerTeamId) : null;

  return {
    phase: s.phase, title: s.title, packId: s.packId, teams: s.teams, roundIndex: s.roundIndex,
    usedQuestionIds: s.usedQuestionIds, pickingTeamId: s.pickingTeamId,
    currentQuestionId: s.currentQuestionId, revealed: s.revealed,
    roster: s.players.map(({ firstName, lastName, teamId, connected }) => ({ firstName, lastName, teamId, connected })),
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
    captains: Object.fromEntries(s.teams.map(t => [t.id, t.captainPlayerId])),
    final,
    finalThemes,
    finalQuestion,
  };
}

export function toPublicState(s: GameState, pack: Pack | null, now: number = Date.now()): PublicState {
  return buildPublic(s, pack, now, null);
}

/** Проекция для конкретного игрока: видит только свою ставку/ответ до вскрытия. */
export function toPlayerFinalState(s: GameState, pack: Pack | null, viewerTeamId: string | null, now: number = Date.now()): PublicState {
  return buildPublic(s, pack, now, viewerTeamId);
}

export function toHostState(s: GameState, pack: Pack | null, now: number = Date.now()): HostState {
  // Ведущий не видит текст/ответ вопроса в окне «выбран, но не прочитан» (п.2): пока он
  // не нажал «Прочитать вопрос», карточка скрыта и у него тоже. currentSpecial оставляем
  // всегда — чтобы работали панели аукциона/кота до reveal.
  const q = findQuestion(pack, s.currentQuestionId);          // полный — для special
  const hideText = s.phase === 'QUESTION' && !s.revealed;     // окно «выбран, не прочитан»
  // Эталонный ответ для ведущего — из оставшейся темы финала (когда тема 1)
  const remTheme = remainingTheme(s, pack);
  const finalReferenceAnswer = remTheme?.question.answer ?? null;
  return {
    ...buildPublic(s, pack, now, null),
    currentPrompt: hideText ? null : (q?.prompt ?? null),
    currentType: hideText ? null : (q?.type ?? null),
    currentMedia: hideText ? null : (q?.media?.replace(/^media\//, '') ?? null),
    currentSpecial: q?.special ?? null,                         // ВСЕГДА — для аукциона/кота
    currentAnswer: hideText ? null : (q?.answer ?? null),
    players: s.players.map(({ id, firstName, lastName, teamId, connected }) => ({ id, firstName, lastName, teamId, connected })),
    finalReferenceAnswer,
  };
}

// Контракты сообщений (используются клиентом и gateway)
export interface ClientToServer {
  join: { gameId: string; firstName: string; lastName: string; teamId: string; clientToken: string };
  rejoin: { clientToken: string };
  createTeam: { name: string };
  hostAction: { action: string; data?: unknown };
  playerBuzz: { reaction: number };
  finalAction: { action: string; data?: unknown };
}
export interface ServerToClient {
  state: PublicState | HostState;
  youAre: { playerId: string; teamId: string; role: 'host' | 'player' | 'board' };
  goSignal: { serverTime: number; greyMs: number; redMs: number; yellowMs: number };
  blocked: { untilMs: number };
  appError: { message: string };
  kicked: {};                        // игрока выгнали — клиент чистит localStorage и показывает форму (п.10)
}
