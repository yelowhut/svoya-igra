/** Формат задержки: <1000 мс → «N мс»; ≥1000 → секунды с запятой, напр. 1224 → «1,224 с». */
export function fmtMs(ms: number): string {
  const v = Math.round(ms);
  if (v < 1000) return `${v} мс`;
  const s = (v / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  return `${s} с`;
}
