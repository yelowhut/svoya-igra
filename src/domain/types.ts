export type QuestionType = 'text' | 'image' | 'audio';
export type SpecialType = 'none' | 'auction' | 'cat';

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  media?: string;        // путь внутри media/
  answer: string;        // только для ведущего
  value: number;
  special: SpecialType;
}
export interface Category { id: string; name: string; questions: Question[]; }

export interface FinalTheme { id: string; name: string; question: Question; }
export interface NormalRound { id: string; name: string; type?: 'normal'; categories: Category[]; }
export interface FinalRound  { id: string; name: string; type: 'final'; themes: FinalTheme[]; }
export type Round = NormalRound | FinalRound;

export interface Pack { id: string; title: string; rounds: Round[]; }

export interface Team { id: string; name: string; score: number; captainPlayerId: string | null; }
export interface Player {
  id: string;
  clientToken: string;
  firstName: string;
  lastName: string;
  teamId: string;
  connected: boolean;
}
export interface BuzzEntry { teamId: string; reaction: number; }
// Запись истории изменения очков в текущем раунде (для табло/ТВ).
// kind='judge' — вердикт по вопросу (correct отражает верно/неверно), 'adjust' — ручная правка ведущим.
export interface ScoreLogEntry { teamId: string; delta: number; kind: 'judge' | 'adjust'; correct?: boolean; }

export type Phase =
  | 'LOBBY' | 'ROUND_INTRO' | 'PICKING' | 'QUESTION'
  | 'BUZZER_ARMED' | 'BUZZER_OPEN' | 'ANSWERING' | 'JUDGED'
  | 'ROUND_END'
  | 'FINAL_INTRO' | 'FINAL_ELIMINATION' | 'FINAL_BETTING' | 'FINAL_QUESTION' | 'FINAL_REVEAL'
  | 'GAME_END';

export interface AuctionState {
  baseValue: number;
  highestBid: number;
  leaderTeamId: string | null;
  passedTeamIds: string[];
}

export interface FinalRuntime {
  themeIds: string[];
  eliminationOrder: string[];
  eliminationTurnIndex: number;
  bets: Record<string, number>;
  answers: Record<string, { text: string; locked: boolean }>;
  revealIndex: number;
  answerDeadline: number | null;
  answerPausedRemainingMs: number | null;
}

export interface GameState {
  gameId: string;
  packId: string;
  title: string;
  teamCount: number;
  phase: Phase;
  teams: Team[];
  players: Player[];
  roundIndex: number;
  usedQuestionIds: string[];
  pickingTeamId: string | null;
  currentQuestionId: string | null;
  revealed: boolean;             // вопрос «прочитан» — показан игрокам/табло (ведущий видит всегда)
  currentValue: number;          // стоимость текущего вопроса (с учётом аукциона)
  buzzQueue: BuzzEntry[];
  answeringIndex: number;        // индекс в buzzQueue
  auction: AuctionState | null;
  assignedTeamId: string | null; // получатель «кота»
  // Результаты команд по ТЕКУЩЕМУ вопросу: вердикт + изменение очков (для фидбэка игроку и истории на пульте)
  questionResults: Record<string, { correct: boolean; delta: number }>;
  roundScoreLog: ScoreLogEntry[];   // история изменения очков в текущем раунде
  lastJudgedTeamId: string | null;
  blocks: Record<string, number>; // playerId -> кол-во фальстартов (для эскалации)
  answerTimerSec: number;             // номинал отсчёта на ответ, сек
  answerDeadline: number | null;      // epoch-ms истечения текущего отсчёта, либо null
  answerPausedRemainingMs: number | null; // остаток на паузе, либо null
  finalAnswerTimerSec: number;        // номинал отсчёта на ответ в финале, сек (дефолт 60)
  final: FinalRuntime | null;         // состояние финального раунда, либо null
}
