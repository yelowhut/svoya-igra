export function isValidTeamName(name: string): boolean {
  const t = name.trim();
  if (t.length < 1 || t.length > 40) return false;
  return /^[A-Za-zА-Яа-яЁё0-9 ._"-]+$/.test(t);
}
