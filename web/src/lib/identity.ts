import { uuid } from './uuid.js';

const KEY = 'svoya:clientToken';
// Токен неймспейсится по роли: один браузер может держать вкладку ведущего и
// вкладку ТВ одновременно — без неймспейса их сессии на сервере (ключ — clientToken)
// схлопывались бы в одну, и host-сокет терял привязку (hostAction переставал слушаться).
export function getClientToken(role: string = 'player'): string {
  const key = `${KEY}:${role}`;
  let t = localStorage.getItem(key);
  if (!t) { t = uuid(); localStorage.setItem(key, t); }
  return t;
}
