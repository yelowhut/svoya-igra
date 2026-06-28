/**
 * Верификация 11 правок UI/движка через реальный интерфейс (пиксели + сокеты).
 * Сетап игры — через API+socket (как в answer-timer.spec), визуальная проверка — через Page.
 *
 * Покрывает фронтенд-поведения, которых нет в существующих E2E:
 *  п.1/2/6 — пульт: баннер выбора, кнопка «Прочитать», текст скрыт до reveal, кликабельность матрицы
 *  п.2     — аукцион: текст показывается ведущему только после AUCTION_WON
 *  п.4/5   — табло: название игры + состав команд до старта раунда
 *  п.9     — табло: очередь реакций видна в PICKING (после закрытия вопроса)
 *  п.7     — табло: экран итогов раунда крупный/по центру
 *  п.10    — кик игрока через UI лобби-логики (player видит форму входа)
 */

import { test, expect, type Page } from '@playwright/test';
import { io as ioClient, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASS = 'test';

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function adminLogin(): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const m = (res.headers.get('set-cookie') ?? '').match(/svoya_admin=[^;]+/);
  if (!m) throw new Error('No svoya_admin cookie');
  return m[0];
}
async function apiAuth(cookie: string, path: string, opts: RequestInit = {}): Promise<any> {
  return api(path, { ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Cookie: cookie } });
}

interface HostConn { socket: Socket; act: (a: string, d?: Record<string, unknown>) => Promise<any>; disconnect: () => void; }
async function hostJoin(cookie: string, gameId: string): Promise<HostConn> {
  const socket = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise<void>((res, rej) => {
    socket.once('connect_error', rej);
    setTimeout(() => rej(new Error('host connect timeout')), 10_000);
    socket.once('connect', () => { socket.once('youAre', () => res()); socket.emit('join', { gameId, role: 'host', firstName: '', lastName: '', teamId: '', newTeamName: '', clientToken: randomUUID() }); });
  });
  await new Promise(r => setTimeout(r, 100));
  socket.removeAllListeners('state');
  const act = (action: string, data: Record<string, unknown> = {}): Promise<any> =>
    new Promise((res) => { socket.once('state', (s) => res(s)); socket.emit('hostAction', { action, data }); });
  return { socket, act, disconnect: () => socket.disconnect() };
}
async function playerConnect(gameId: string, teamId: string, name: string): Promise<Socket> {
  const socket = ioClient(BASE, { transports: ['websocket'] });
  await new Promise<void>((res, rej) => {
    setTimeout(() => rej(new Error(`player ${name} connect timeout`)), 10_000);
    socket.once('connect', () => { socket.once('youAre', () => res()); socket.once('appError', (m) => rej(new Error(m.message))); socket.emit('join', { gameId, role: 'player', firstName: name, lastName: name, teamId, newTeamName: '', clientToken: randomUUID() }); });
  });
  return socket;
}
function waitState(socket: Socket, predicate: (s: any) => boolean, timeoutMs = 15_000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { socket.off('state', handler); rej(new Error('waitState timeout')); }, timeoutMs);
    function handler(s: any) { if (predicate(s)) { clearTimeout(t); res(s); } else { socket.once('state', handler); } }
    socket.once('state', handler);
  });
}

interface Setup { cookie: string; gameId: string; packId: string; host: HostConn; teamAId: string; teamBId: string; packFull: any; }
async function setupGame(start: 'none' | 'gameOnly' | 'round'): Promise<Setup> {
  const cookie = await adminLogin();
  const zipBuf = readFileSync('packs/example.zip');
  const form = new FormData();
  form.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'example.zip');
  const { packId } = await apiAuth(cookie, '/api/packs', { method: 'POST', body: form });
  const { gameId } = await apiAuth(cookie, '/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId, title: 'E2E-проверка-11', teamCount: 2, answerTimerSec: 10 }),
  });
  const host = await hostJoin(cookie, gameId);
  const stA = await host.act('createTeam', { name: 'Команда А' });
  const teamAId = stA.teams.find((t: any) => t.name === 'Команда А')?.id;
  const stB = await host.act('createTeam', { name: 'Команда Б' });
  const teamBId = stB.teams.find((t: any) => t.name === 'Команда Б')?.id;
  if (start === 'gameOnly' || start === 'round') await host.act('startGame');
  if (start === 'round') await host.act('startRound', { roundIndex: 0 });
  const packFull = await api(`/api/packs/${packId}`);
  return { cookie, gameId, packId, host, teamAId, teamBId, packFull };
}

function findQuestion(packFull: any, special: string): { questionId: string; value: number; special: string } | null {
  const r0 = packFull.rounds[0];
  for (const cat of r0.categories ?? []) for (const q of cat.questions ?? []) if (q.special === special) return { questionId: q.id, value: q.value, special: q.special };
  return null;
}

async function openPult(page: Page, gameId: string) {
  await page.addInitScript((gid) => localStorage.setItem('svoya:host', JSON.stringify({ gameId: gid })), gameId);
  await page.goto('/admin');
  await page.locator('input[type=password]').fill(PASS);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('button', { name: 'Пульт · игра' }).click();
}

// ── п.1/2/6: пульт — баннер, кнопка «Прочитать», скрытие текста, кликабельность ──
test('п.1/2/6: пульт — баннер выбора, «Прочитать вопрос», текст скрыт до reveal', async ({ page }) => {
  test.setTimeout(60_000);
  const g = await setupGame('round'); // → PICKING
  await openPult(page, g.gameId);

  // п.6 — баннер «Выбирает: <команда>»
  await expect(page.locator('.pick-banner')).toContainText('Выбирает');

  // п.1 — в PICKING клетки матрицы кликабельны
  await expect(page.locator('.matrix .cell:not(.used)').first()).toBeEnabled();

  // выбираем ОБЫЧНЫЙ вопрос (через socket — надёжно), пульт-страница отрисует реакцию
  const normal = findQuestion(g.packFull, 'none');
  expect(normal, 'в example-паке должен быть обычный вопрос').not.toBeNull();
  await g.host.act('selectQuestion', { questionId: normal!.questionId, value: normal!.value, special: 'none' });

  // п.2 — кнопка «Прочитать вопрос» видна (load-bearing), текст вопроса СКРЫТ от ведущего
  await expect(page.getByRole('button', { name: 'Прочитать вопрос' })).toBeVisible();
  await expect(page.locator('.qcard')).toHaveCount(0);

  // п.1 — в QUESTION&!revealed клетки всё ещё кликабельны (смена карточки)
  await expect(page.locator('.matrix .cell:not(.used)').first()).toBeEnabled();

  await page.screenshot({ path: 'test-results/verify-pult-before-reveal.png', fullPage: true });

  // нажимаем «Прочитать вопрос» на реальной странице → текст появляется
  await page.getByRole('button', { name: 'Прочитать вопрос' }).click();
  await expect(page.locator('.qcard .qtext')).toBeVisible();
  await page.screenshot({ path: 'test-results/verify-pult-after-reveal.png', fullPage: true });
});

// ── п.2: аукцион — текст показывается ведущему только после AUCTION_WON ──
test('п.2: аукцион — текст вопроса скрыт до AUCTION_WON, виден после', async ({ page }) => {
  test.setTimeout(60_000);
  const g = await setupGame('round');
  const auction = findQuestion(g.packFull, 'auction');
  test.skip(!auction, 'в example-паке нет аукционного вопроса');
  await openPult(page, g.gameId);
  await g.host.act('selectQuestion', { questionId: auction!.questionId, value: auction!.value, special: 'auction' });

  // панель аукциона видна, но текст вопроса скрыт
  await expect(page.locator('.panel.gold')).toBeVisible();
  await expect(page.locator('.qcard')).toHaveCount(0);

  // присуждаем победу команде А → фаза ANSWERING → текст должен открыться ведущему
  await g.host.act('auctionWon', { teamId: g.teamAId, amount: auction!.value });
  await expect(page.locator('.qcard .qtext')).toBeVisible();
  await page.screenshot({ path: 'test-results/verify-auction-reveal.png', fullPage: true });
});

// ── п.4/5: табло — название игры + состав команд до старта раунда ──
test('п.4/5: табло — название игры и ростеры команд до раунда', async ({ page }) => {
  test.setTimeout(60_000);
  const g = await setupGame('gameOnly'); // → ROUND_INTRO
  await playerConnect(g.gameId, g.teamAId, 'Алиса');
  await playerConnect(g.gameId, g.teamBId, 'Борис');
  await page.goto(`/board?game=${g.gameId}`);

  await expect(page.locator('.game-name')).toContainText('E2E-проверка-11');
  await expect(page.getByText('Алиса Алиса')).toBeVisible();
  await expect(page.getByText('Борис Борис')).toBeVisible();
  await page.screenshot({ path: 'test-results/verify-board-pregame.png', fullPage: true });
});

// ── п.9 + п.7: табло — очередь реакций в PICKING; экран итогов раунда ──
test('п.9/7: табло — очередь реакций в PICKING и крупный экран итогов', async ({ page }) => {
  test.setTimeout(90_000);
  const g = await setupGame('round');
  const pA = await playerConnect(g.gameId, g.teamAId, 'Алиса');
  const pB = await playerConnect(g.gameId, g.teamBId, 'Борис');
  await page.goto(`/board?game=${g.gameId}`);

  const normal = findQuestion(g.packFull, 'none')!;
  await g.host.act('selectQuestion', { questionId: normal.questionId, value: normal.value, special: 'none' });
  await g.host.act('reveal');
  await g.host.act('arm');
  await g.host.act('open');
  // обе команды жмут (валидная реакция > 0) → ANSWERING
  pA.emit('playerBuzz', { reaction: 250 });
  pB.emit('playerBuzz', { reaction: 400 });
  await waitState(g.host.socket, (s) => s.phase === 'ANSWERING');
  await g.host.act('judge', { teamId: g.teamAId, correct: true });
  await g.host.act('closeQuestion'); // → PICKING, очередь должна сохраниться (п.9)

  // табло показывает очередь по командам (не по игрокам); главное — она ВИДНА в PICKING
  await expect(page.locator('.queue')).toContainText('Команда А');
  await page.screenshot({ path: 'test-results/verify-board-queue-picking.png', fullPage: true });

  // п.7 — итоги раунда крупно/по центру
  await g.host.act('endRound');
  await expect(page.locator('.results-screen')).toBeVisible();
  await expect(page.locator('.board.lg')).toBeVisible();
  await page.screenshot({ path: 'test-results/verify-board-round-end.png', fullPage: true });
});

// ── п.10: кик игрока — игрок отключается и видит форму входа ──
test('п.10: кик игрока — игрок возвращается к форме входа', async ({ page }) => {
  test.setTimeout(60_000);
  const g = await setupGame('round');

  // игрок входит через реальную страницу /play
  await page.goto(`/play?game=${g.gameId}`);
  await page.locator('input[placeholder="Фамилия"]').fill('Кикнутый');
  await page.locator('input[placeholder="Имя"]').fill('Тест');
  await page.locator('select.fld').selectOption(g.teamAId);
  // следим за появлением игрока в состоянии хоста ДО клика
  const joined = waitState(g.host.socket, (s) => (s.players?.length ?? 0) > 0);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.whoami')).toBeVisible(); // вошёл в игру

  const st = await joined;
  const playerId = st.players[0].id;
  await g.host.act('kickPlayer', { playerId });

  // play-страница перезагрузится и покажет форму входа
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.whoami')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/verify-player-kicked.png', fullPage: true });
});
