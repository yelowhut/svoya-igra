interface SessionResponse { authenticated: boolean }

export async function getSession(): Promise<boolean> {
  const r = await fetch('/api/admin/session');
  if (!r.ok) return false;
  return (await r.json() as SessionResponse).authenticated;
}

export async function login(password: string): Promise<boolean> {
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return r.ok;
}

export async function logout(): Promise<void> {
  await fetch('/api/admin/logout', { method: 'POST' });
}
