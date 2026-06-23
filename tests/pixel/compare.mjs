/**
 * SP3 pixel-diff compare script.
 * Compares live screenshots against design reference screenshots using pixelmatch.
 *
 * Run: node tests/pixel/compare.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// Пары: [боевой скриншот, эталон дизайна]. Эталоны и боевые скрины обычно
// разного размера/кадрирования — приводим к минимальному общему размеру.
const pairs = [
  ['test-results/sp3/landing.png', 'docs/design_handoff_svoya_igra/screenshots/01-landing.png', 'landing'],
  ['test-results/sp3/lobby.png',   'docs/design_handoff_svoya_igra/screenshots/05-lobby.png',   'lobby'],
  ['test-results/sp3/pult.png',    'docs/design_handoff_svoya_igra/screenshots/06-host-answering.png', 'pult'],
];

for (const [aPath, bPath, name] of pairs) {
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
  const ca = crop(a), cb = crop(b);
  const diff = new PNG({ width: w, height: h });
  const mismatch = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.12 });
  const pct = ((mismatch / (w * h)) * 100).toFixed(2);
  writeFileSync(`test-results/sp3/${name}-diff.png`, PNG.sync.write(diff));
  console.log(`${name}: ${pct}% несовпадений (${w}×${h})`);
}
