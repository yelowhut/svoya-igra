import type { BuzzEntry } from '../types.js';

/** Фальстарт = нажатие ДО «зелёного» (reaction измеряется от момента green: <0 — рано). */
export function validateBuzz(reaction: number): 'valid' | 'falsestart' {
  return reaction < 0 ? 'falsestart' : 'valid';
}

/** Микроблок за фальстарт. Эскалация в пределах одного вопроса:
 *  0 → 100–200 мс, 1 → 200–400, 2 и далее → 400–800 (потолок 800). */
export function computeBlock(offenseIndex: number, rnd: () => number): number {
  const ranges: Array<[number, number]> = [[100, 200], [200, 400], [400, 800]];
  const [lo, hi] = ranges[Math.min(offenseIndex, ranges.length - 1)];
  return Math.round(lo + rnd() * (hi - lo));
}

/** Случайное расписание стартовых огней F1 (мс на каждое состояние), 400–800 мс каждое.
 *  Сервер выбирает один раз на «Открыть баззер» и рассылает всем — зелёный синхронен. */
export function f1Schedule(rnd: () => number): { greyMs: number; redMs: number; yellowMs: number } {
  const gap = () => Math.round(400 + rnd() * 400); // 400..800
  return { greyMs: gap(), redMs: gap(), yellowMs: gap() };
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
