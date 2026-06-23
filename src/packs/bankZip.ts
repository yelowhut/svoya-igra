import AdmZip from 'adm-zip';
import { z } from 'zod';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import type { Db } from '../persistence/db.js';
import { allCategoriesForExport, allQuestionsForExport } from '../persistence/bankRepo.js';

const bankJsonSchema = z.object({
  categories: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), position: z.number().int() })),
  questions: z.array(z.object({
    id: z.string().min(1), categoryId: z.string().min(1),
    type: z.enum(['text', 'image', 'audio']),
    prompt: z.string(), answer: z.string(),
    media: z.string().regex(/^bank\/media\/[^/\\]+$/).nullable(), position: z.number().int(),
  })),
});

export function exportBank(db: Db, mediaDir: string): Buffer {
  const categories = allCategoriesForExport(db);
  const questions = allQuestionsForExport(db);
  const zip = new AdmZip();
  zip.addFile('bank.json', Buffer.from(JSON.stringify({ categories, questions }, null, 2)));
  for (const q of questions) {
    if (!q.media) continue;
    const file = join(mediaDir, q.media);
    if (existsSync(file)) zip.addFile(q.media, readFileSync(file)); // entryName = bank/media/<name>
  }
  return zip.toBuffer();
}

export function importBank(db: Db, mediaDir: string, zipBuffer: Buffer): { categories: number; questions: number } {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntry('bank.json');
  if (!entry) throw new Error('В архиве нет bank.json');
  const data = bankJsonSchema.parse(JSON.parse(zip.readAsText(entry)));

  // распаковка медиа (защита от traversal)
  const mediaRoot = join(mediaDir, 'bank', 'media');
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('bank/media/')) continue;
    const target = join(mediaDir, e.entryName);
    const resolved = resolve(target);
    if (resolved !== resolve(mediaRoot) && !resolved.startsWith(resolve(mediaRoot) + sep)) {
      throw new Error(`Небезопасный путь в архиве: ${e.entryName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.getData());
  }

  const upCat = db.prepare('INSERT OR REPLACE INTO bank_categories (id,name,position) VALUES (?,?,?)');
  const upQ = db.prepare('INSERT OR REPLACE INTO bank_questions (id,category_id,type,prompt,answer,media,position) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const c of data.categories) upCat.run(c.id, c.name, c.position);
    for (const q of data.questions) upQ.run(q.id, q.categoryId, q.type, q.prompt, q.answer, q.media, q.position);
  })();
  return { categories: data.categories.length, questions: data.questions.length };
}
