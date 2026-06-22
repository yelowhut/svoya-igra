export function isValidTeamName(name: string): boolean {
  const t = name.trim();
  return t.length >= 1 && t.length <= 40 && /^[A-Za-zА-Яа-яЁё0-9 ._"-]+$/.test(t);
}
