import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep, extname, basename } from 'node:path';

export function gcMedia(mediaDir: string, paths: Array<string | null | undefined>): void {
  for (const p of paths) {
    if (!p) continue;
    try { rmSync(join(mediaDir, p), { force: true }); } catch { /* ignore */ }
  }
}

export const ALLOWED_MIME: Record<string, true> = {
  'image/jpeg': true, 'image/png': true, 'image/webp': true,
  'audio/mpeg': true, 'audio/ogg': true, 'audio/mp4': true,
};
export const MAX_BANK_MEDIA_BYTES = 26214400; // 25 МБ

export function isAllowedMime(m: string): boolean { return ALLOWED_MIME[m] === true; }

export function sanitizeBankFilename(questionId: string, original: string): string {
  const rawExt = extname(original).toLowerCase();
  const ext = rawExt.replace(/[^.a-z0-9]/g, '').slice(0, 10);
  let base = basename(original, extname(original)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  if (base.length > 80) base = base.slice(0, 80);
  if (!base) base = 'file';
  return `${questionId}-${base}${ext}`;
}

export function saveBankMedia(mediaDir: string, name: string, data: Buffer): string {
  const dir = join(mediaDir, 'bank', 'media');
  const target = join(dir, name);
  const resolved = resolve(target);
  if (resolved !== resolve(dir) && !resolved.startsWith(resolve(dir) + sep)) {
    throw new Error('небезопасное имя файла');
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, data);
  return `bank/media/${name}`;
}
