import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerAuth, requireAdmin } from './auth.js';
import { config } from '../config.js';

function makeApp() {
  const app = Fastify({ logger: false });
  registerAuth(app, { ...config, adminPassword: 'secret', cookieSecret: 'test-secret' });
  app.get('/api/_guarded', { preHandler: requireAdmin }, async () => ({ ok: true }));
  return app;
}

function authCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find(x => x.name === 'svoya_admin')!;
  return `${c.name}=${c.value}`;
}

describe('admin auth', () => {
  it('session=false без куки', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/session' });
    expect(res.json()).toEqual({ authenticated: false });
    await app.close();
  });

  it('неверный пароль → 401', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'nope' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('логин ставит куку, session=true с кукой', async () => {
    const app = makeApp();
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    expect(login.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie: authCookie(login) } });
    expect(res.json()).toEqual({ authenticated: true });
    await app.close();
  });

  it('гард: 401 без куки, 200 с кукой', async () => {
    const app = makeApp();
    const noAuth = await app.inject({ method: 'GET', url: '/api/_guarded' });
    expect(noAuth.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const ok = await app.inject({ method: 'GET', url: '/api/_guarded', headers: { cookie: authCookie(login) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    await app.close();
  });

  it('logout присылает куку с пустым значением (сброс)', async () => {
    const app = makeApp();
    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'secret' } });
    const logout = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie: authCookie(login) } });
    const cleared = logout.cookies.find(c => c.name === 'svoya_admin');
    expect(cleared?.value).toBe('');
    await app.close();
  });
});
