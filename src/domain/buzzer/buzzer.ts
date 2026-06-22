import type { BuzzEntry } from '../types.js';

export function validateBuzz(reaction: number, minReactionMs: number): 'valid' | 'falsestart' {
  return reaction < minReactionMs ? 'falsestart' : 'valid';
}

export function computeBlock(offenseIndex: number, minMs: number, maxMs: number, rnd: () => number): number {
  const base = minMs + rnd() * (maxMs - minMs);
  return Math.round(base * Math.pow(2, offenseIndex));
}

export function rankQueue(raw: Array<{ teamId: string; reaction: number }>): BuzzEntry[] {
  const best = new Map<string, number>();
  for (const b of raw) {
    const cur = best.get(b.teamId);
    if (cur === undefined || b.reaction < cur) best.set(b.teamId, b.reaction);
  }
  return [...best.entries()]
    .map(([teamId, reaction]) => ({ teamId, reaction }))
    .sort((x, y) => x.reaction - y.reaction);
}
