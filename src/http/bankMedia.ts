import { rmSync } from 'node:fs';
import { join } from 'node:path';

export function gcMedia(mediaDir: string, paths: Array<string | null | undefined>): void {
  for (const p of paths) {
    if (!p) continue;
    try { rmSync(join(mediaDir, p), { force: true }); } catch { /* ignore */ }
  }
}
