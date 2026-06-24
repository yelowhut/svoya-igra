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
export interface Round { id: string; name: string; categories: Category[]; }
export interface Pack { id: string; title: string; rounds: Round[]; }

export interface Team { id: string; name: string; score: number; }
export interface Player {
  id: string;
  clientToken: string;
  firstName: string;
  lastName: string;
  teamId: string;
  connected: boolean;
}
export interface BuzzEntry { teamId: string; reaction: number; }

export type Phase =
  | 'LOBBY' | 'ROUND_INTRO' | 'PICKING' | 'QUESTION'
  | 'BUZZER_ARMED' | 'BUZZER_OPEN' | 'ANSWERING' | 'JUDGED'
  | 'ROUND_END' | 'GAME_END';

export interface AuctionState {
  baseValue: number;
  highestBid: number;
  leaderTeamId: string | null;
  passedTeamIds: string[];
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
  lastJudgedTeamId: string | null;
  blocks: Record<string, number>; // playerId -> кол-во фальстартов (для эскалации)
  answerTimerSec: number;             // номинал отсчёта на ответ, сек
  answerDeadline: number | null;      // epoch-ms истечения текущего отсчёта, либо null
  answerPausedRemainingMs: number | null; // остаток на паузе, либо null
}
