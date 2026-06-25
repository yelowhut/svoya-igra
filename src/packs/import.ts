import AdmZip from 'adm-zip';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { parseGameJson } from './schema.js';
import type { Pack } from '../domain/types.js';

export function importPackZip(zipBuffer: Buffer, mediaTargetDir: string, idGen: () => string = () => crypto.randomUUID()): Pack {
  const zip = new AdmZip(zipBuffer);
  const gameEntry = zip.getEntry('game.json');
  if (!gameEntry) throw new Error('В архиве нет game.json');
  const data = JSON.parse(zip.readAsText(gameEntry));
  const pack = parseGameJson(data, idGen);

  // проверка наличия всех media-путей
  const names = new Set(zip.getEntries().map(e => e.entryName));
  for (const r of pack.rounds) {
    const questions = r.type === 'final'
      ? r.themes.map(t => t.question)
      : r.categories.flatMap(c => c.questions);
    for (const q of questions) {
      if (q.media && !names.has(q.media)) throw new Error(`media-файл отсутствует в архиве: ${q.media}`);
    }
  }

  const dest = join(mediaTargetDir, pack.id);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (!e.entryName.startsWith('media/')) continue;
    const target = join(dest, e.entryName);
    const resolved = resolve(target);
    if (resolved !== resolve(dest) && !resolved.startsWith(resolve(dest) + sep)) {
      throw new Error(`Небезопасный путь в архиве: ${e.entryName}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.getData());
  }
  return pack;
}
