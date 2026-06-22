import type { SpecialType } from './types.js';

export type GameEvent =
  | Ev<'GAME_CREATED', { gameId: string; packId: string; title: string; teamCount: number }>
  | Ev<'TEAM_CREATED', { teamId: string; name: string }>
  | Ev<'PLAYER_JOINED', { playerId: string; clientToken: string; firstName: string; lastName: string; teamId: string }>
  | Ev<'PLAYER_CONNECTED', { playerId: string }>
  | Ev<'PLAYER_DISCONNECTED', { playerId: string }>
  | Ev<'GAME_STARTED', {}>
  | Ev<'ROUND_STARTED', { roundIndex: number; pickingTeamId: string }>
  | Ev<'QUESTION_SELECTED', { questionId: string; value: number; special: SpecialType }>
  | Ev<'BUZZER_ARMED', {}>
  | Ev<'BUZZER_OPENED', {}>
  | Ev<'BUZZ_RECORDED', { teamId: string; reaction: number }>
  | Ev<'ANSWER_JUDGED', { teamId: string; correct: boolean; value: number }>
  | Ev<'QUESTION_CLOSED', {}>
  | Ev<'AUCTION_BID', { teamId: string; amount: number }>
  | Ev<'AUCTION_PASSED', { teamId: string }>
  | Ev<'AUCTION_WON', { teamId: string; amount: number }>
  | Ev<'CAT_ASSIGNED', { toTeamId: string }>
  | Ev<'ROUND_ENDED', {}>
  | Ev<'GAME_ENDED', {}>
  | Ev<'SCORE_ADJUSTED', { teamId: string; delta: number }>;

export interface Ev<T extends string, P> { id: string; type: T; payload: P }

export type EventType = GameEvent['type'];
export type PayloadOf<T extends EventType> = Extract<GameEvent, { type: T }>['payload'];

export function makeEvent<T extends EventType>(
  type: T, payload: PayloadOf<T>, idGen: () => string = () => crypto.randomUUID(),
): Extract<GameEvent, { type: T }> {
  return { id: idGen(), type, payload } as Extract<GameEvent, { type: T }>;
}
