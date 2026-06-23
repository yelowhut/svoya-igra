import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.js';
import { gcMedia, isAllowedMime, sanitizeBankFilename, saveBankMedia, MAX_BANK_MEDIA_BYTES } from './bankMedia.js';
import type { ServerDeps } from './server.js';
import {
  createCategory, listCategories, renameCategory, moveCategory, deleteCategory,
  createQuestion, listQuestions, getQuestion, updateQuestion, moveQuestion, deleteQuestion,
} from '../persistence/bankRepo.js';

const TYPES = new Set(['text', 'image', 'audio']);
const DIRS = new Set(['up', 'down']);

export function registerBank(app: FastifyInstance, deps: ServerDeps): void {
  const { db, config } = deps;
  const guard = { preHandler: requireAdmin };

  app.get('/api/bank/categories', guard, async () => listCategories(db));

  app.post('/api/bank/categories', guard, async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'имя категории обязательно' });
    return createCategory(db, name.trim());
  });

  app.put('/api/bank/categories/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'имя категории обязательно' });
    if (!renameCategory(db, id, name.trim())) return reply.code(404).send({ error: 'категория не найдена' });
    return { ok: true };
  });

  app.post('/api/bank/categories/:id/move', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { direction } = (req.body ?? {}) as { direction?: string };
    if (!DIRS.has(direction as string)) return reply.code(400).send({ error: 'direction должен быть up|down' });
    return { moved: moveCategory(db, id, direction as 'up' | 'down') };
  });

  app.delete('/api/bank/categories/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = deleteCategory(db, id);
    if (!res.found) return reply.code(404).send({ error: 'категория не найдена' });
    gcMedia(config.mediaDir, res.mediaPaths);
    return { ok: true };
  });

  app.get('/api/bank/categories/:id/questions', guard, async (req) => {
    const { id } = req.params as { id: string };
    return listQuestions(db, id);
  });

  app.post('/api/bank/categories/:id/questions', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const created = createQuestion(db, id);
    if (!created) return reply.code(404).send({ error: 'категория не найдена' });
    return created;
  });

  app.put('/api/bank/questions/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ('category_id' in body || 'categoryId' in body) {
      return reply.code(400).send({ error: 'перенос вопроса между категориями запрещён' });
    }
    if (body.type !== undefined && !TYPES.has(body.type as string)) {
      return reply.code(400).send({ error: 'тип должен быть text|image|audio' });
    }
    const before = getQuestion(db, id);
    if (!before) return reply.code(404).send({ error: 'вопрос не найден' });
    const fields: { type?: 'text' | 'image' | 'audio'; prompt?: string; answer?: string; media?: string | null } = {};
    if (body.type !== undefined) fields.type = body.type as 'text' | 'image' | 'audio';
    if (body.prompt !== undefined) fields.prompt = String(body.prompt);
    if (body.answer !== undefined) fields.answer = String(body.answer);
    if ('media' in body) fields.media = body.media === null ? null : String(body.media);
    updateQuestion(db, id, fields);
    if ('media' in fields && before.media && before.media !== fields.media) {
      gcMedia(config.mediaDir, [before.media]);
    }
    return { ok: true };
  });

  app.post('/api/bank/questions/:id/move', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { direction } = (req.body ?? {}) as { direction?: string };
    if (!DIRS.has(direction as string)) return reply.code(400).send({ error: 'direction должен быть up|down' });
    return { moved: moveQuestion(db, id, direction as 'up' | 'down') };
  });

  app.delete('/api/bank/questions/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = deleteQuestion(db, id);
    if (!res.found) return reply.code(404).send({ error: 'вопрос не найден' });
    gcMedia(config.mediaDir, [res.media]);
    return { ok: true };
  });

  app.post('/api/bank/questions/:id/media', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = getQuestion(db, id);
    if (!q) return reply.code(404).send({ error: 'вопрос не найден' });

    const file = await (req as any).file({ limits: { fileSize: MAX_BANK_MEDIA_BYTES } });
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    if (!isAllowedMime(file.mimetype)) {
      file.file.resume(); // слить поток, чтобы запрос не завис
      return reply.code(415).send({ error: 'недопустимый тип файла' });
    }
    const buf = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'файл слишком большой (макс 25 МБ)' });

    const name = sanitizeBankFilename(id, file.filename ?? 'file');
    const path = saveBankMedia(config.mediaDir, name, buf);
    const oldMedia = q.media;
    updateQuestion(db, id, { media: path });
    if (oldMedia && oldMedia !== path) gcMedia(config.mediaDir, [oldMedia]);
    return { path };
  });
}
