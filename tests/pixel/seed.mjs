/**
 * SP3 Docker-gate seeding script.
 * Seeds the server into 3 states:
 *   1. LOBBY (active game) — for landing screenshot
 *   2. PICKING (round started) — for lobby screenshot
 *   3. BUZZER_OPEN (question open) — for pult screenshot
 *
 * Outputs gameId + other IDs to stdout as JSON for use by snapshot.mjs.
 *
 * Run: node tests/pixel/seed.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const BASE = process.env.SNAP_BASE ?? 'http://localhost:3000';
const PASS = process.env.SNAP_PASS ?? 'admin';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiJSON(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function apiJSONAuth(path, cookie, opts = {}) {
  const headers = { ...(opts.headers ?? {}), Cookie: cookie };
  return apiJSON(path, { ...opts, headers });
}

// ─── Step 1: Login ───────────────────────────────────────────────────────────

console.log('1. Logging in...');
const loginRes = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASS }),
});
if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
const setCookie = loginRes.headers.get('set-cookie');
if (!setCookie) throw new Error('No set-cookie header from login');
// Extract the cookie value: "svoya_admin=<val>; Path=..."
const cookieMatch = setCookie.match(/svoya_admin=[^;]+/);
if (!cookieMatch) throw new Error('Could not parse svoya_admin cookie');
const adminCookie = cookieMatch[0];
console.log('   Cookie:', adminCookie.substring(0, 30) + '...');

// ─── Step 2: Upload pack ─────────────────────────────────────────────────────

console.log('2. Uploading pack...');
const packPath = resolve('packs/example.zip');
const zipBuffer = readFileSync(packPath);
const form = new FormData();
form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'example.zip');

const packRes = await fetch(`${BASE}/api/packs`, {
  method: 'POST',
  headers: { Cookie: adminCookie },
  body: form,
});
if (!packRes.ok) {
  const t = await packRes.text();
  throw new Error(`Pack upload failed: ${packRes.status}: ${t}`);
}
const packData = await packRes.json();
const packId = packData.packId;
console.log('   packId:', packId, 'title:', packData.title);

// ─── Step 3: Create game ─────────────────────────────────────────────────────

console.log('3. Creating game...');
const gameData = await apiJSONAuth('/api/games', adminCookie, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ packId, title: 'Демо-игра', teamCount: 3 }),
});
const gameId = gameData.gameId;
console.log('   gameId:', gameId);

// ─── Step 4: Socket — join as host, create 3 teams, startGame, startRound ────

console.log('4. Connecting via socket as host...');
const clientToken = randomUUID();
const socket = ioClient(BASE, {
  transports: ['websocket'],
  extraHeaders: { Cookie: adminCookie },
});

await new Promise((resolve, reject) => {
  socket.on('connect', () => { console.log('   Socket connected:', socket.id); resolve(); });
  socket.on('connect_error', reject);
  setTimeout(() => reject(new Error('Socket connect timeout')), 8000);
});

// Join as host
await new Promise((res) => {
  socket.once('youAre', (m) => { console.log('   youAre:', JSON.stringify(m)); res(); });
  socket.emit('join', {
    gameId, role: 'host',
    firstName: '', lastName: '', teamId: '', newTeamName: '',
    clientToken,
  });
});

function hostAction(action, data) {
  return new Promise((res) => {
    socket.once('state', () => res());
    socket.emit('hostAction', { action, data: data ?? {} });
  });
}

// Create 3 teams
console.log('   Creating teams...');
await hostAction('createTeam', { name: 'Команда А' });
await hostAction('createTeam', { name: 'Команда Б' });
await hostAction('createTeam', { name: 'Команда В' });

// startGame (required to exit LOBBY phase → ROUND_INTRO)
console.log('   startGame...');
await hostAction('startGame');

// ─── Step 5: Activate game (landing shows active) ────────────────────────────

console.log('5. Activating game...');
await apiJSONAuth(`/api/games/${gameId}/activate`, adminCookie, { method: 'POST' });
console.log('   Game activated.');

// ─── Step 6: startRound then selectQuestion then open (buzzer) ───────────────

console.log('6. Starting round...');
await hostAction('startRound', { roundIndex: 0 });

// Fetch pack to find a real question
console.log('   Fetching pack data to find a question...');
const packFull = await apiJSON(`/api/packs/${packId}`);
const firstRound = packFull.rounds[0];
const firstCat = firstRound.categories[0];
const firstQ = firstCat.questions[0];
if (!firstQ) throw new Error('No questions found in pack round 0 cat 0');
console.log(`   Selecting question: id=${firstQ.id} value=${firstQ.value} special=${firstQ.special ?? 'none'}`);

await hostAction('selectQuestion', {
  questionId: firstQ.id,
  value: firstQ.value,
  special: firstQ.special ?? null,
});

console.log('   Opening buzzer...');
await hostAction('open');

console.log('7. Game is in BUZZER_OPEN state. Done.');
socket.disconnect();

// ─── Write state file ─────────────────────────────────────────────────────────

const state = { gameId, packId, BASE };
writeFileSync('test-results/sp3/seed-state.json', JSON.stringify(state, null, 2));
console.log('\nState saved to test-results/sp3/seed-state.json');
console.log(JSON.stringify(state));
