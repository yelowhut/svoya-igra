// crypto.randomUUID() доступен ТОЛЬКО в secure-контексте (HTTPS или localhost).
// При доступе по обычному HTTP на LAN-IP (например http://192.168.x.x:3000) его нет —
// падало бы `crypto.randomUUID is not a function`. getRandomValues доступен и без secure-контекста.
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // версия 4
  b[8] = (b[8] & 0x3f) | 0x80; // вариант
  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
