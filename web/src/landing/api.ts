export interface ActiveGame {
  gameId: string;
  title: string;
  phase: string;
  teamCount: number;
  playerCount: number;
  totalRounds: number;
  currentRound: number;
}

export async function fetchActiveGame(): Promise<ActiveGame | null> {
  try {
    const r = await fetch('/api/active-game');
    if (!r.ok) return null;
    return (await r.json()) as ActiveGame | null;
  } catch {
    return null;
  }
}
