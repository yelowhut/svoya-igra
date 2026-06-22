const KEY = 'svoya:clientToken';
export function getClientToken(): string {
  let t = localStorage.getItem(KEY);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(KEY, t); }
  return t;
}
