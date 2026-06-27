import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.js';
import { gcMedia, isAllowedMime, sanitizeBankFilename, saveBankMedia, MAX_BANK_MEDIA_BYTES, MAX_ZIP_UPLOAD_BYTES } from './bankMedia.js';
import type { ServerDeps } from './server.js';
import { exportBank, importBank } from '../packs/bankZip.js';
import {
  createCategory, listCategories, renameCategory, reorderCategories, deleteCategory,
  createQuestion, listQuestions, getQuestion, updateQuestion, reorderQuestions, deleteQuestion,
} from '../persistence/bankRepo.js';

const TYPES = new Set(['text', 'image', 'audio']);
const VALID_MEDIA = /^bank\/media\/[^/\\]+$/;

function asIdArray(body: unknown): string[] | null {
  const ids = (body as { orderedIds?: unknown })?.orderedIds;
  if (!Array.isArray(ids) || !ids.every(x => typeof x === 'string')) return null;
  return ids as string[];
}

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

  app.post('/api/bank/categories/reorder', guard, async (req, reply) => {
    const ids = asIdArray(req.body);
    if (!ids) return reply.code(400).send({ error: 'orderedIds должен быть массивом строк' });
    reorderCategories(db, ids);
    return { ok: true };
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
    if ('media' in body && body.media !== null && !VALID_MEDIA.test(String(body.media))) {
      return reply.code(400).send({ error: 'недопустимый путь медиа' });
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

  app.post('/api/bank/categories/:id/questions/reorder', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ids = asIdArray(req.body);
    if (!ids) return reply.code(400).send({ error: 'orderedIds должен быть массивом строк' });
    reorderQuestions(db, id, ids);
    return { ok: true };
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

  app.get('/api/bank/export', guard, async (_req, reply) => {
    const buf = exportBank(db, config.mediaDir);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', 'attachment; filename="bank.zip"');
    return reply.send(buf);
  });

  app.post('/api/bank/import', guard, async (req, reply) => {
    const file = await (req as any).file({ limits: { fileSize: MAX_ZIP_UPLOAD_BYTES } });
    if (!file) return reply.code(400).send({ error: 'нет файла' });
    const buf = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'файл слишком большой (макс 100 МБ)' });
    try {
      return importBank(db, config.mediaDir, buf);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
