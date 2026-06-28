/**
 * Верификация правок ТВ/аудио/финала через реальный UI (пиксели + сокеты).
 *  1. ТВ: QR-код виден ДО начала игры (предыгровой экран)
 *  2. Аудио-вопрос: баннер «АУДИО ВОПРОС» на ТВ и планшете; на ТВ <audio autoplay>
 *  3. Финал ТВ: крупные адаптивные плашки тем (FINAL_INTRO)
 *  4. Финал ТВ: раскладка FINAL_QUESTION — крупный вопрос, отсчёт под ним, готовность ниже
 */
import { test, expect, type Page } from '@playwright/test';
import { io as ioClient, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASS = 'test';

async function adminLogin(): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }),
  });
  const m = (res.headers.get('set-cookie') ?? '').match(/svoya_admin=[^;]+/);
  if (!m) throw new Error('No svoya_admin cookie');
  return m[0];
}
async function apiAuth(cookie: string, path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Cookie: cookie } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

interface HostConn { socket: Socket; act: (a: string, d?: Record<string, unknown>) => Promise<any>; }
async function hostJoin(cookie: string, gameId: string): Promise<HostConn> {
  const socket = ioClient(BASE, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise<void>((res, rej) => {
    setTimeout(() => rej(new Error('host connect timeout')), 10_000);
    socket.once('connect', () => { socket.once('youAre', () => res()); socket.emit('join', { gameId, role: 'host', firstName: '', lastName: '', teamId: '', newTeamName: '', clientToken: randomUUID() }); });
  });
  await new Promise(r => setTimeout(r, 100));
  socket.removeAllListeners('state');
  const act = (action: string, data: Record<string, unknown> = {}): Promise<any> =>
    new Promise((res) => { socket.once('state', (s) => res(s)); socket.emit('hostAction', { action, data }); });
  return { socket, act };
}
async function playerConnect(gameId: string, teamId: string, name: string): Promise<Socket> {
  const socket = ioClient(BASE, { transports: ['websocket'] });
  await new Promise<void>((res, rej) => {
    setTimeout(() => rej(new Error(`player ${name} connect timeout`)), 10_000);
    socket.once('connect', () => { socket.once('youAre', () => res()); socket.once('appError', (m) => rej(new Error(m.message))); socket.emit('join', { gameId, role: 'player', firstName: name, lastName: name, teamId, newTeamName: '', clientToken: randomUUID() }); });
  });
  return socket;
}
function finalAct(socket: Socket, action: string, data: Record<string, unknown> = {}) { socket.emit('finalAction', { action, data }); }
function waitState(socket: Socket, predicate: (s: any) => boolean, timeoutMs = 15_000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { socket.off('state', h); rej(new Error('waitState timeout')); }, timeoutMs);
    function h(s: any) { if (predicate(s)) { clearTimeout(t); res(s); } else { socket.once('state', h); } }
    socket.once('state', h);
  });
}

const uid = () => randomUUID();

/** Банк-вопрос (опц. с аудио-медиа) → возвращает questionId (+ media path). */
async function makeBankQuestion(cookie: string, categoryId: string, type: 'text' | 'audio', prompt: string): Promise<{ qid: string; media: string | null }> {
  const q = await apiAuth(cookie, `/api/bank/categories/${categoryId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const qid = q.id;
  let media: string | null = null;
  if (type === 'audio') {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0])], { type: 'audio/mpeg' }), 'tone.mp3');
    const up = await apiAuth(cookie, `/api/bank/questions/${qid}/media`, { method: 'POST', body: form });
    media = up.path;
  }
  await apiAuth(cookie, `/api/bank/questions/${qid}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, prompt, answer: 'ответ', ...(media ? { media } : {}) }),
  });
  return { qid, media };
}

/** Публикует шаблон (1 обычный вопрос + опц. финал с 2 текст-темами), создаёт игру. */
async function seedGame(opts: { tag: string; normalType: 'text' | 'audio'; withFinal: boolean; finalPrompt?: string }): Promise<{ cookie: string; gameId: string }> {
  const { tag, normalType, withFinal, finalPrompt } = opts;
  const cookie = await adminLogin();
  const cat = await apiAuth(cookie, '/api/bank/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Кат-${tag}` }) });
  const categoryId = cat.id;
  const normal = await makeBankQuestion(cookie, categoryId, normalType, `Вопрос ${tag}`);
  const f1 = withFinal ? await makeBankQuestion(cookie, categoryId, 'text', finalPrompt ?? `Финал-1 ${tag}`) : null;
  const f2 = withFinal ? await makeBankQuestion(cookie, categoryId, 'text', finalPrompt ?? `Финал-2 ${tag}`) : null;

  const tpl = await apiAuth(cookie, '/api/game-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const templateId = tpl.id;
  const doc = await apiAuth(cookie, `/api/game-templates/${templateId}`);
  const colId = uid(), rowId = uid();
  doc.title = `Игра-${tag}`;
  doc.rounds = [
    { id: uid(), type: 'normal', name: 'Раунд 1', columns: [{ id: colId, value: 100 }], rows: [{ id: rowId, categoryId, cells: [{ columnId: colId, questionId: normal.qid, special: 'none' }] }] },
  ];
  if (withFinal) doc.rounds.push({ id: uid(), type: 'final', name: 'Финал', themes: [{ id: uid(), name: `Тема А ${tag}`, questionId: f1!.qid }, { id: uid(), name: `Тема Б ${tag}`, questionId: f2!.qid }] });
  await apiAuth(cookie, `/api/game-templates/${templateId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  const pub = await apiAuth(cookie, `/api/game-templates/${templateId}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'new' }) });
  const packId = pub.packId;
  const game = await apiAuth(cookie, '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packId, title: `Игра-${tag}`, teamCount: 2, answerTimerSec: 10, finalAnswerTimerSec: 30 }) });
  return { cookie, gameId: game.gameId };
}

async function makeTeams(host: HostConn): Promise<{ teamAId: string; teamBId: string }> {
  const sA = await host.act('createTeam', { name: 'Команда А' });
  const teamAId = sA.teams.find((t: any) => t.name === 'Команда А').id;
  const sB = await host.act('createTeam', { name: 'Команда Б' });
  const teamBId = sB.teams.find((t: any) => t.name === 'Команда Б').id;
  return { teamAId, teamBId };
}

// ── 1. QR до начала игры ──
test('ТВ: QR-код виден до начала игры (предыгровой экран)', async ({ page }) => {
  test.setTimeout(60_000);
  const { cookie, gameId } = await seedGame({ tag: 'qr' + Date.now(), normalType: 'text', withFinal: false });
  const host = await hostJoin(cookie, gameId);
  await makeTeams(host);
  await host.act('startGame'); // → ROUND_INTRO (предыгровой экран)
  await page.goto(`/board?game=${gameId}`);
  await expect(page.locator('.join-qr.big img')).toBeVisible();
  await expect(page.locator('.game-name')).toBeVisible();
  await page.screenshot({ path: 'test-results/tv-qr-pregame.png', fullPage: true });
});

// ── 2. Аудио-вопрос: баннер на ТВ и планшете; на ТВ autoplay ──
test('Аудио-вопрос: баннер «АУДИО ВОПРОС» на ТВ+планшете, autoplay на ТВ', async ({ page, context }) => {
  test.setTimeout(60_000);
  const { cookie, gameId } = await seedGame({ tag: 'audio' + Date.now(), normalType: 'audio', withFinal: false });
  const host = await hostJoin(cookie, gameId);
  const { teamAId } = await makeTeams(host);
  await host.act('startGame');
  const stRound = await host.act('startRound', { roundIndex: 0 });
  const pack = await apiAuth(cookie, `/api/packs/${stRound.packId}`);
  const questionId = pack.rounds[0].categories[0].questions[0].id;

  // игрок входит через реальную страницу /play
  await page.goto(`/play?game=${gameId}`);
  await page.locator('input[placeholder="Фамилия"]').fill('Игрок');
  await page.locator('input[placeholder="Имя"]').fill('Один');
  await page.locator('select.fld').selectOption(teamAId);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.whoami')).toBeVisible();

  // табло
  const board = await context.newPage();
  await board.goto(`/board?game=${gameId}`);

  // выбираем аудио-вопрос и читаем (reveal)
  const st = await host.act('selectQuestion', { questionId, value: 100, special: 'none' });
  expect(st.phase).toBe('QUESTION');
  await host.act('reveal');

  // ТВ: баннер + autoplay-аудио
  await expect(board.locator('.audio-badge')).toBeVisible();
  await expect(board.locator('audio[autoplay]')).toHaveCount(1);
  await board.screenshot({ path: 'test-results/tv-audio-board.png', fullPage: true });

  // планшет: баннер
  await expect(page.locator('.audio-badge')).toBeVisible();
  await page.screenshot({ path: 'test-results/tv-audio-play.png', fullPage: true });
});

// ── 3 + 4. Финал: крупные темы (INTRO) и раскладка FINAL_QUESTION ──
test('Финал ТВ: крупные плашки тем (INTRO) и раскладка вопроса', async ({ page }) => {
  test.setTimeout(90_000);
  const { cookie, gameId } = await seedGame({ tag: 'final' + Date.now(), normalType: 'text', withFinal: true });
  const host = await hostJoin(cookie, gameId);
  const { teamAId, teamBId } = await makeTeams(host);
  await host.act('startGame');
  // даём очки, чтобы команды попали в eliminationOrder
  await host.act('adjustScore', { teamId: teamAId, delta: 300 });
  await host.act('adjustScore', { teamId: teamBId, delta: 200 });
  await host.act('startRound', { roundIndex: 0 });

  // капитаны = подключённые игроки
  const pA = await playerConnect(gameId, teamAId, 'КапА');
  const pB = await playerConnect(gameId, teamBId, 'КапБ');
  const byTeam: Record<string, Socket> = { [teamAId]: pA, [teamBId]: pB };

  await host.act('endRound');
  await host.act('startFinal');            // назначает капитанов, → FINAL_INTRO

  await page.goto(`/board?game=${gameId}`);
  await expect(page.locator('.theme-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/tv-final-intro-big.png', fullPage: true });

  // → вычёркивание
  const elim = await host.act('finalBeginElimination'); // FINAL_ELIMINATION
  const order: string[] = elim.final.eliminationOrder;
  const themeIds: string[] = elim.final.themeIds;
  // ход у order[turnIndex]; его капитан вычёркивает одну тему → остаётся 1 → FINAL_BETTING
  const turnTeam = order[elim.final.eliminationTurnIndex];
  finalAct(byTeam[turnTeam], 'removeTheme', { themeId: themeIds[0] });
  await waitState(host.socket, (s) => s.phase === 'FINAL_BETTING');

  // обе команды ставят → FINAL_QUESTION
  finalAct(pA, 'placeBet', { amount: 50 });
  finalAct(pB, 'placeBet', { amount: 50 });
  await waitState(host.socket, (s) => s.phase === 'FINAL_QUESTION');

  // раскладка: крупный вопрос, крупный отсчёт по центру, готовность ниже
  await expect(page.locator('.fq-qtext')).toBeVisible();
  await expect(page.locator('.fq-timer-big')).toBeVisible();
  await expect(page.locator('.fq-ready-center')).toBeVisible();
  // порядок по вертикали: вопрос выше таймера, таймер выше готовности
  const qBox = await page.locator('.fq-qtext').boundingBox();
  const tBox = await page.locator('.fq-timer-big').boundingBox();
  const rBox = await page.locator('.fq-ready-center').boundingBox();
  expect(qBox!.y).toBeLessThan(tBox!.y);
  expect(tBox!.y).toBeLessThan(rBox!.y);
  await page.screenshot({ path: 'test-results/tv-final-question.png', fullPage: true });
});

// ── Регресс: длинный финальный вопрос не вылезает за пределы 1920×1080 ──
test('Финал ТВ: длинный вопрос помещается в экран 1920×1080', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const longPrompt = 'В каком году и при каких обстоятельствах произошло событие, которое историки впоследствии назвали поворотным моментом эпохи, повлиявшим на судьбы миллионов людей и определившим ход развития мировой культуры, науки и политики на десятилетия вперёд?';
  const { cookie, gameId } = await seedGame({ tag: 'ovf' + Date.now(), normalType: 'text', withFinal: true, finalPrompt: longPrompt });
  const host = await hostJoin(cookie, gameId);
  const { teamAId, teamBId } = await makeTeams(host);
  await host.act('startGame');
  await host.act('adjustScore', { teamId: teamAId, delta: 300 });
  await host.act('adjustScore', { teamId: teamBId, delta: 200 });
  await host.act('startRound', { roundIndex: 0 });
  const pA = await playerConnect(gameId, teamAId, 'КапА');
  const pB = await playerConnect(gameId, teamBId, 'КапБ');
  const byTeam: Record<string, Socket> = { [teamAId]: pA, [teamBId]: pB };
  await host.act('endRound');
  await host.act('startFinal');
  await page.goto(`/board?game=${gameId}`);
  const elim = await host.act('finalBeginElimination');
  const order: string[] = elim.final.eliminationOrder;
  const themeIds: string[] = elim.final.themeIds;
  finalAct(byTeam[order[elim.final.eliminationTurnIndex]], 'removeTheme', { themeId: themeIds[0] });
  await waitState(host.socket, (s) => s.phase === 'FINAL_BETTING');
  finalAct(pA, 'placeBet', { amount: 50 });
  finalAct(pB, 'placeBet', { amount: 50 });
  await waitState(host.socket, (s) => s.phase === 'FINAL_QUESTION');

  await expect(page.locator('.fq-qtext')).toBeVisible();
  await page.screenshot({ path: 'test-results/tv-final-question-long.png' });

  // всё содержимое экрана финального вопроса должно умещаться в 1080 по высоте
  const q = (await page.locator('.fq-qtext').boundingBox())!;
  const t = (await page.locator('.fq-timer-big').boundingBox())!;
  const r = (await page.locator('.fq-ready-center').boundingBox())!;
  expect(q.y, 'верх вопроса не выше экрана').toBeGreaterThanOrEqual(0);
  expect(r.y + r.height, 'низ готовности команд внутри экрана').toBeLessThanOrEqual(1080);
  // вертикальный порядок сохранён
  expect(q.y + q.height).toBeLessThanOrEqual(t.y + 1);
  expect(t.y + t.height).toBeLessThanOrEqual(r.y + 1);
});
