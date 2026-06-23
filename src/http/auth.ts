import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Config } from '../config.js';

const COOKIE_NAME = 'svoya_admin';

export function registerAuth(app: FastifyInstance, config: Config): void {
  app.register(fastifyCookie, { secret: config.cookieSecret });

  app.post('/api/admin/login', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || password !== config.adminPassword) {
      return reply.code(401).send({ error: 'неверный пароль' });
    }
    reply.setCookie(COOKIE_NAME, '1', {
      path: '/', httpOnly: true, sameSite: 'lax', signed: true,
    });
    return { authenticated: true };
  });

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { authenticated: false };
  });

  app.get('/api/admin/session', async (req) => ({ authenticated: isAuthed(req) }));
}

function isAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const r = req.unsignCookie(raw);
  return r.valid && r.value === '1';
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthed(req)) {
    reply.code(401).send({ error: 'требуется вход администратора' });
  }
}
