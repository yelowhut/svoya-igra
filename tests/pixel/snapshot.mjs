/**
 * SP3 Docker-gate snapshot script.
 * Captures three screenshots from the live :3000 runtime using Playwright chromium.
 *
 * Prerequisites: run tests/pixel/seed.mjs first to seed the game state.
 * Run: node tests/pixel/snapshot.mjs
 *
 * NOT a playwright test — plain node script, no playwright.config.ts interference.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.SNAP_BASE ?? 'http://localhost:3000';
const PASS = process.env.SNAP_PASS ?? 'admin';

mkdirSync('test-results/sp3', { recursive: true });

// Load seeded game state
let gameId;
try {
  const state = JSON.parse(readFileSync('test-results/sp3/seed-state.json', 'utf8'));
  gameId = state.gameId;
  console.log('Loaded seed state: gameId =', gameId);
} catch {
  throw new Error('seed-state.json not found. Run tests/pixel/seed.mjs first.');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 913, height: 540 } });

// ─── 1. Landing (with active game) ───────────────────────────────────────────
console.log('Capturing landing.png...');
await page.goto(`${BASE}/`);
await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/sp3/landing.png' });
console.log('  Done: landing.png');

// ─── 2. Admin login ───────────────────────────────────────────────────────────
console.log('Logging into admin...');
await page.goto(`${BASE}/admin`);
// Fill password if login form is shown
const pwdInput = page.locator('input[type=password]');
if (await pwdInput.count() > 0) {
  await pwdInput.fill(PASS);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForTimeout(500);
}

// Set workingGameId in localStorage so Lobby/Pult know which game we're in
// Key: 'svoya:host', value: JSON.stringify({ gameId })
await page.evaluate((gid) => {
  localStorage.setItem('svoya:host', JSON.stringify({ gameId: gid }));
}, gameId);
// Reload so the Svelte store picks up the localStorage value
await page.reload();
await page.waitForTimeout(500);

// ─── 3. Lobby screenshot ─────────────────────────────────────────────────────
console.log('Navigating to Лобби и команды...');
await page.getByRole('button', { name: 'Лобби и команды' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/sp3/lobby.png' });
console.log('  Done: lobby.png');

// ─── 4. Pult screenshot ───────────────────────────────────────────────────────
console.log('Navigating to Пульт · игра...');
await page.getByRole('button', { name: 'Пульт · игра' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/sp3/pult.png' });
console.log('  Done: pult.png');

await browser.close();
console.log('\nСкриншоты сохранены в test-results/sp3/');
