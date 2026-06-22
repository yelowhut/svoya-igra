import type { Team } from '../types.js';

export function lowestScoreTeamId(teams: Team[]): string {
  let best = teams[0];
  for (const t of teams) if (t.score < best.score) best = t;
  return best.id;
}

export function nextAnsweringIndex(current: number, queueLen: number): number | null {
  const next = current + 1;
  return next < queueLen ? next : null;
}
