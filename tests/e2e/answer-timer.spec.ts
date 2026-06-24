/**
 * E2E: engine-таймер ответа — таймаут, пауза/возобновление, спец-вопрос «Кот».
 *
 * Стратегия: игру и серверное состояние создаём через API + socket (прямо из
 * Node.js-процесса теста), чтобы не зависеть от UI-кликов для сетапа.
 * Playwright Pages используем только там, где нужна визуальная проверка UI.
 *
 * answerTimerSec = 10 (минимальный кламп) → тест умещается в 30 с.
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import { io as ioClient, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── Конфигурация ──────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASS = 'test';

// ── HTTP-хелперы ──────────────────────────────────────────────────────────────

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function adminLogin(): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const sc = res.headers.get('set-cookie') ?? '';
  const m = sc.match(/svoya_admin=[^;]+/);
  if (!m) throw new Error('No svoya_admin cookie');
  return m[0];
}

async function apiAuth(cookie: string, path: string, opts: RequestInit = {}): Promise<any> {
  const headers: HeadersInit = {
    ...(opts.headers as Record<string, string> ?? {}),
    Cookie: cookie,
  };
  return api(path, { ...opts, headers });
}

// ── Socket-хелперы ────────────────────────────────────────────────────────────

interface HostConn {
  socket: Socket;
  /** Отправляет hostAction и ждёт следующего 'state' в ответ. */
  act: (action: string, data?: Record<string, unknown>) => Promise<any>;
  disconnect: () => void;
}

async function hostJoin(cookie: string, gameId: string): Promise<HostConn> {
  const socket = ioClient(BASE, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
  });

  await new Promise<void>((res, rej) => {
    socket.once('connect_error', rej);
    setTimeout(() => rej(new Error('socket connect timeout')), 10_000);
    socket.once('connect', () => {
      socket.once('youAre', () => res());
      socket.emit('join', {
        gameId, role: 'host',
        firstName: '', lastName: '', teamId: '', newTeamName: '',
        clientToken: randomUUID(),
      });
    });
  });

  // После join сервер рассылает state — сбрасываем его чтобы не мешал
  // последующим ожиданиям act()
  await new Promise(r => setTimeout(r, 100));
  socket.removeAllListeners('state');

  const act = (action: string, data: Record<string, unknown> = {}): Promise<any> =>
    new Promise((res) => {
      socket.once('state', (s) => res(s));
      socket.emit('hostAction', { action, data });
    });

  return { socket, act, disconnect: () => socket.disconnect() };
}

async function playerConnect(
  gameId: string,
  teamId: string,
  name: string,
): Promise<Socket> {
  if (!teamId) throw new Error(`playerConnect: teamId is falsy for ${name}`);
  const socket = ioClient(BASE, { transports: ['websocket'] });
  await new Promise<void>((res, rej) => {
    setTimeout(() => rej(new Error(`player ${name} connect timeout`)), 10_000);
    socket.once('connect_error', (e) => rej(new Error(`player ${name} connect_error: ${e.message}`)));
    socket.once('connect', () => {
      socket.once('youAre', () => res());
      socket.once('appError', (m) => rej(new Error(`appError joining ${name}: ${m.message}`)));
      socket.emit('join', {
        gameId, role: 'player',
        firstName: name, lastName: name, teamId, newTeamName: '',
        clientToken: randomUUID(),
      });
    });
  });
  return socket;
}

/** Ждёт следующего 'state' с условием. */
function waitState(socket: Socket, predicate: (s: any) => boolean, timeoutMs = 20_000): Promise<any> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      socket.off('state', handler);
      rej(new Error(`waitState timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    function handler(s: any) {
      if (predicate(s)) {
        clearTimeout(t);
        res(s);
      } else {
        socket.once('state', handler);
      }
    }
    socket.once('state', handler);
  });
}

// ── Полный сетап игры ─────────────────────────────────────────────────────────

interface GameSetup {
  cookie: string;
  gameId: string;
  packId: string;
  host: HostConn;
  teamAId: string;
  teamBId: string;
  packFull: any;
}

async function setupGame(): Promise<GameSetup> {
  const cookie = await adminLogin();

  // Загружаем пак
  const zipBuf = readFileSync('packs/example.zip');
  const form = new FormData();
  form.append('file', new Blob([zipBuf], { type: 'application/zip' }), 'example.zip');
  const packData = await apiAuth(cookie, '/api/packs', { method: 'POST', body: form });
  const packId: string = packData.packId;

  // Создаём игру с таймером 10 с
  const { gameId } = await apiAuth(cookie, '/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId, title: 'E2E-таймер', teamCount: 2, answerTimerSec: 10 }),
  });

  const host = await hostJoin(cookie, gameId);

  // Создаём команды и читаем ID из возвращённого state
  const stA = await host.act('createTeam', { name: 'Команда А' });
  const teamAId: string = stA.teams.find((t: any) => t.name === 'Команда А')?.id;
  if (!teamAId) throw new Error('teamAId not found in state after createTeam А');

  const stB = await host.act('createTeam', { name: 'Команда Б' });
  const teamBId: string = stB.teams.find((t: any) => t.name === 'Команда Б')?.id;
  if (!teamBId) throw new Error('teamBId not found in state after createTeam Б');

  await host.act('startGame');
  // Примечание: игру НЕ активируем (не нужно для E2E логики) — это исключает
  // загрязнение «активной игры» для параллельных тестов лендинга.
  await host.act('startRound', { roundIndex: 0 });

  const packFull = await api(`/api/packs/${packId}`);

  return { cookie, gameId, packId, host, teamAId, teamBId, packFull };
}

// ─────────────────────────────────────────────────────────────────────────────
// Тест 1: таймаут уводит ход к следующей команде и штрафует первую
// ─────────────────────────────────────────────────────────────────────────────

test('таймаут: −value у отвечавшей, ход к следующей команде', async () => {
  test.setTimeout(45_000);

  const { host, gameId, teamAId, teamBId, packFull } = await setupGame();

  try {
    // История×100, special=none
    const normalQ = packFull.rounds[0].categories[0].questions[0];
    await host.act('selectQuestion', {
      questionId: normalQ.id, value: normalQ.value, special: normalQ.special ?? null,
    });
    await host.act('open');

    // Подключаем двух игроков
    const pA = await playerConnect(gameId, teamAId, 'Аня');
    const pB = await playerConnect(gameId, teamBId, 'Боря');

    // Небольшая пауза после open, затем оба баззят (A быстрее)
    await new Promise(r => setTimeout(r, 400));
    pA.emit('playerBuzz', { reaction: 150 });
    await new Promise(r => setTimeout(r, 300));
    pB.emit('playerBuzz', { reaction: 450 });

    // Ждём ANSWERING (команда А отвечает первой)
    const stAnswering = await waitState(
      host.socket,
      (s) => s.phase === 'ANSWERING' && s.answeringTeamId === teamAId,
      8_000,
    );
    expect(stAnswering.answeringTeamId).toBe(teamAId);
    const scoreABefore: number = stAnswering.teams.find((t: any) => t.id === teamAId)?.score ?? 0;

    // Не судим — ждём таймаута (10 с + 5 с запас)
    const stTimedOut = await waitState(
      host.socket,
      (s) => s.answeringTeamId === teamBId || s.phase === 'JUDGED',
      18_000,
    );

    // Команда А получила штраф −value
    const scoreAAfter: number = stTimedOut.teams.find((t: any) => t.id === teamAId)?.score ?? 0;
    expect(scoreAAfter).toBe(scoreABefore - normalQ.value);

    // Ход перешёл к команде Б
    expect(stTimedOut.answeringTeamId).toBe(teamBId);

    pA.disconnect(); pB.disconnect();
  } finally {
    host.disconnect();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Тест 2: пауза замораживает таймер, продолжение — снова убывает
// ─────────────────────────────────────────────────────────────────────────────

test('пауза: таймер замирает; продолжение — снова убывает', async ({ context }) => {
  test.setTimeout(45_000);

  const { cookie, gameId, packFull, host, teamAId } = await setupGame();

  // Открываем пульт в браузере
  const hostPage = await context.newPage();
  await hostPage.goto('/admin');
  await hostPage.locator('input[type=password]').fill(PASS);
  await hostPage.getByRole('button', { name: 'Войти' }).click();
  // Устанавливаем workingGameId через localStorage
  await hostPage.evaluate((gid) => {
    localStorage.setItem('svoya:host', JSON.stringify({ gameId: gid }));
  }, gameId);
  await hostPage.reload();
  await expect(hostPage.getByRole('button', { name: 'Пульт · игра' })).toBeVisible();
  await hostPage.getByRole('button', { name: 'Пульт · игра' }).click();

  try {
    const normalQ = packFull.rounds[0].categories[0].questions[0];
    await host.act('selectQuestion', {
      questionId: normalQ.id, value: normalQ.value, special: null,
    });
    await host.act('open');

    // Игрок А баззит
    const pA = await playerConnect(gameId, teamAId, 'Аня');
    await new Promise(r => setTimeout(r, 400));
    pA.emit('playerBuzz', { reaction: 150 });

    // Ждём ANSWERING на пульте
    await expect(hostPage.locator('.timer-badge')).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.locator('.answering-banner')).toBeVisible();

    // Ждём, пока таймер покажет реальное число (не прочерк)
    await expect(hostPage.locator('.timer-badge')).not.toHaveText('—', { timeout: 5_000 });

    // Нажимаем «⏸ Пауза»
    await hostPage.getByRole('button', { name: '⏸ Пауза' }).click();

    // Замершее значение сразу после паузы
    const valAtPause = await hostPage.locator('.timer-badge').innerText();
    // Ждём 2500 мс — при паузе значение не должно меняться
    await hostPage.waitForTimeout(2500);
    const valAfterWait = await hostPage.locator('.timer-badge').innerText();
    expect(valAfterWait).toBe(valAtPause);

    // «▶ Продолжить» — таймер снова идёт
    await hostPage.getByRole('button', { name: '▶ Продолжить' }).click();
    const valResumed = await hostPage.locator('.timer-badge').innerText();
    await hostPage.waitForTimeout(2500);
    const valAfterResume = await hostPage.locator('.timer-badge').innerText();
    expect(parseInt(valAfterResume, 10)).toBeLessThan(parseInt(valResumed, 10));

    pA.disconnect();
  } finally {
    host.disconnect();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Тест 3: спец-вопрос «Кот» — после передачи и таймаута нет «Отвечает»
// ─────────────────────────────────────────────────────────────────────────────

test('кот: после передачи команде и таймаута — нет answeringTeamId', async () => {
  test.setTimeout(45_000);

  const { host, teamAId, teamBId, packFull } = await setupGame();

  try {
    // Находим вопрос с special=cat (Кино×100 в example.zip)
    let catQ: any = null;
    for (const r of packFull.rounds) {
      for (const c of r.categories) {
        for (const q of c.questions) {
          if (q.special === 'cat') { catQ = q; break; }
        }
        if (catQ) break;
      }
      if (catQ) break;
    }
    if (!catQ) { test.skip(); return; }

    await host.act('selectQuestion', {
      questionId: catQ.id, value: catQ.value, special: 'cat',
    });

    // Передаём «кота» команде Б (не пикинг-команде)
    const stAfterCat = await host.act('catAssign', { toTeamId: teamBId });
    // catAssign приводит к ANSWERING — команда Б отвечает
    const stAnswering = stAfterCat.phase === 'ANSWERING'
      ? stAfterCat
      : await waitState(host.socket, (s) => s.phase === 'ANSWERING', 5_000);
    expect(stAnswering.answeringTeamId).toBe(teamBId);

    // Ждём таймаута (10 с + 5 с запас)
    const stAfterTimeout = await waitState(
      host.socket,
      // После таймаута answeringTeamId становится null или '' (falsy)
      (s) => s.phase === 'JUDGED' || !s.answeringTeamId,
      18_000,
    );
    // В JUDGED нет активно отвечающей команды
    expect(stAfterTimeout.answeringTeamId).toBeFalsy();
  } finally {
    host.disconnect();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Тест 4: табло — при ANSWERING НЕ должны одновременно показываться
//         currentPrompt и блок отсчёта (структурная проверка T15-риска)
// ─────────────────────────────────────────────────────────────────────────────

test('табло: при ANSWERING prompt скрыт, countdown виден', async ({ context }) => {
  test.setTimeout(30_000);

  const { gameId, host, teamAId, packFull } = await setupGame();

  // Открываем табло
  const boardPage = await context.newPage();
  await boardPage.goto(`/board?game=${gameId}`);
  await boardPage.waitForTimeout(1500); // ждём подключения к socket

  try {
    const normalQ = packFull.rounds[0].categories[0].questions[0];
    await host.act('selectQuestion', {
      questionId: normalQ.id, value: normalQ.value, special: null,
    });
    await host.act('open');

    // На табло появляется текст вопроса (фаза BUZZER_OPEN)
    await expect(boardPage.locator('p').filter({ hasText: normalQ.prompt })).toBeVisible({ timeout: 8_000 });

    // Игрок А баззит
    const pA = await playerConnect(gameId, teamAId, 'Аня');
    await new Promise(r => setTimeout(r, 400));
    pA.emit('playerBuzz', { reaction: 150 });

    // Ждём ANSWERING на табло: блок .ba-name должен появиться
    await expect(boardPage.locator('.ba-name')).toBeVisible({ timeout: 8_000 });

    // После патча board/App.svelte (строка 31): при ANSWERING prompt скрыт
    // guard: !(state.phase === 'ANSWERING' && state.answeringTeamId)
    await expect(boardPage.locator('p').filter({ hasText: normalQ.prompt })).toBeHidden({ timeout: 3_000 });

    pA.disconnect();
  } finally {
    host.disconnect();
  }
});
