import type { SpecialType } from './types.js';

export type GameEvent =
  | Ev<'GAME_CREATED', { gameId: string; packId: string; title: string; teamCount: number; answerTimerSec: number; finalAnswerTimerSec: number }>
  | Ev<'TEAM_CREATED', { teamId: string; name: string }>
  | Ev<'TEAM_RENAMED', { teamId: string; name: string }>
  | Ev<'TEAM_DELETED', { teamId: string }>
  | Ev<'PLAYER_JOINED', { playerId: string; clientToken: string; firstName: string; lastName: string; teamId: string }>
  | Ev<'PLAYER_MOVED', { playerId: string; teamId: string }>
  | Ev<'PLAYER_CONNECTED', { playerId: string }>
  | Ev<'PLAYER_DISCONNECTED', { playerId: string }>
  | Ev<'GAME_STARTED', {}>
  | Ev<'ROUND_STARTED', { roundIndex: number; pickingTeamId: string }>
  | Ev<'QUESTION_SELECTED', { questionId: string; value: number; special: SpecialType }>
  | Ev<'QUESTION_REVEALED', {}>
  | Ev<'BUZZER_ARMED', {}>
  | Ev<'BUZZER_OPENED', {}>
  | Ev<'BUZZ_RECORDED', { teamId: string; reaction: number }>
  | Ev<'ANSWERS_STARTED', {}>
  | Ev<'ANSWER_JUDGED', { teamId: string; correct: boolean; value: number }>
  | Ev<'QUESTION_CLOSED', {}>
  | Ev<'ROUND_RESET', {}>
  | Ev<'AUCTION_BID', { teamId: string; amount: number }>
  | Ev<'AUCTION_PASSED', { teamId: string }>
  | Ev<'AUCTION_WON', { teamId: string; amount: number }>
  | Ev<'CAT_ASSIGNED', { toTeamId: string }>
  | Ev<'ROUND_ENDED', {}>
  | Ev<'GAME_ENDED', {}>
  | Ev<'ANSWER_TIMER_STARTED', { deadline: number }>
  | Ev<'ANSWER_TIMER_PAUSED', { remainingMs: number }>
  | Ev<'ANSWER_TIMER_RESUMED', { deadline: number }>
  | Ev<'ANSWER_TIMED_OUT', { teamId: string }>
  | Ev<'SCORE_ADJUSTED', { teamId: string; delta: number }>
  | Ev<'CAPTAIN_ASSIGNED', { teamId: string; playerId: string }>
  | Ev<'FINAL_STARTED', { themeIds: string[] }>
  | Ev<'FINAL_ELIMINATION_BEGAN', {}>
  | Ev<'FINAL_THEME_REMOVED', { themeId: string; byTeamId: string }>
  | Ev<'FINAL_BET_PLACED', { teamId: string; amount: number }>
  | Ev<'FINAL_ANSWER_UPDATED', { teamId: string; text: string }>
  | Ev<'FINAL_ANSWER_LOCKED', { teamId: string }>
  | Ev<'FINAL_TIMER_STARTED', { deadline: number }>
  | Ev<'FINAL_TIMER_PAUSED', { remainingMs: number }>
  | Ev<'FINAL_TIMER_RESUMED', { deadline: number }>
  | Ev<'FINAL_TIMED_OUT', {}>
  | Ev<'FINAL_ANSWER_JUDGED', { teamId: string; correct: boolean }>;

export interface Ev<T extends string, P> { id: string; type: T; payload: P }

export type EventType = GameEvent['type'];
export type PayloadOf<T extends EventType> = Extract<GameEvent, { type: T }>['payload'];

export function makeEvent<T extends EventType>(
  type: T, payload: PayloadOf<T>, idGen: () => string = () => crypto.randomUUID(),
): Extract<GameEvent, { type: T }> {
  return { id: idGen(), type, payload } as Extract<GameEvent, { type: T }>;
}
