/** Доля оставшегося времени блокировки: 1 в начале → 0 в конце, кламп [0,1]. */
export function ringFraction(now: number, start: number, until: number): number {
  if (until <= start) return 0;
  const f = (until - now) / (until - start);
  return Math.max(0, Math.min(1, f));
}

/** stroke-dashoffset для кольца длиной circumference: fraction=1 → 0 (полное), fraction=0 → C (пустое). */
export function ringDashoffset(fraction: number, circumference: number): number {
  return circumference * (1 - fraction);
}

/** Оставшиеся секунды (округление вверх), не отрицательны. */
export function secondsLeft(now: number, until: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
