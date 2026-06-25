<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore } from '../lib/store.js';
  import { joinAs } from '../lib/socket.js';
  import Scoreboard from '../lib/Scoreboard.svelte';
  import Matrix from '../lib/Matrix.svelte';
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';
  import { fmtMs } from '../lib/format.js';
  import qrcode from 'qrcode-generator';
  const gameId = new URLSearchParams(location.search).get('game') ?? '';
  let state: any = null; $: state = $gameStore;

  // QR для входа игрока в эту игру: ${origin}/play?game=<id>.
  // origin берём из адреса табло — если открыто по localhost, телефоны не достанут (предупреждаем).
  let qrSrc = '';
  let qrLocal = false;
  if (gameId) {
    const joinUrl = `${location.origin}/play?game=${gameId}`;
    qrLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();
    qrSrc = qr.createDataURL(6, 8);
  }

  // Структура пака — для матрицы раунда (категории/клетки), как на пульте.
  let packRounds: any[] = [];
  let loadedPackId = '';
  $: if (state?.packId && state.packId !== loadedPackId) {
    loadedPackId = state.packId;
    fetch(`/api/packs/${state.packId}`).then(r => r.json()).then(p => { packRounds = p.rounds ?? []; }).catch(() => {});
  }
  $: currentRound = packRounds[state?.roundIndex] ?? null;

  const teamName = (id: string): string => state?.teams?.find((t: any) => t.id === id)?.name ?? '?';
  $: answeringName = teamName(state?.answeringTeamId);
  // Вердикты по текущему вопросу (фаза JUDGED): кто ответил верно / список неверных.
  $: results = state?.questionResults ?? {};
  $: correctTeamId = Object.keys(results).find((id) => results[id]?.correct) ?? null;
  $: wrongTeamIds = Object.keys(results).filter((id) => !results[id]?.correct);
  // История очков раунда — последние сверху.
  $: scoreLog = [...(state?.roundScoreLog ?? [])].reverse();

  const queueNames = (s: any): string =>
    (s.buzzQueue ?? [])
      .map((b: { teamId: string; reaction: number }, i: number) =>
        `${i + 1}. ${teamName(b.teamId)} (${fmtMs(Math.max(0, b.reaction))})`)
      .join('   ·   ');

  onMount(async () => {
    if (!gameId) return;
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json());
    if (r.exists) joinAs(gameId, 'board');
  });
</script>

<main>
  {#if !state}
    <div class="center"><h1 class="neon">Своя игра</h1><p>Игра ещё не началась</p></div>
  {:else if state.phase === 'GAME_END'}
    <div class="stack">
      <h1 class="neon big">🏆 Финал! 🎉</h1>
      <Scoreboard teams={state.teams} />
    </div>
  {:else if state.phase === 'ROUND_END'}
    <div class="stack">
      <h1 class="neon">Итоги раунда {state.roundIndex + 1}</h1>
      <Scoreboard teams={state.teams} />
    </div>
  {:else}
    <!-- Шапка: раунд + название -->
    <header class="topbar">
      <span class="round-chip">Раунд {state.roundIndex + 1}</span>
      <span class="title">{state.title}</span>
    </header>

    <section class="stage">
      {#if state.phase === 'ANSWERING' && state.answeringTeamId}
        <!-- Отвечает команда + крупный отсчёт -->
        <div class="board-answer">
          <div class="ba-lead">ОТВЕЧАЕТ</div>
          <div class="ba-name">{answeringName}</div>
          <div class="ba-time" class:low={$answerLow}>осталось <span>{$answerSecondsLeft ?? '—'}</span></div>
        </div>
      {:else if state.phase === 'JUDGED'}
        <!-- Явный вердикт по вопросу -->
        {#if correctTeamId}
          <div class="verdict ok">
            <div class="v-lead">✓ ВЕРНО</div>
            <div class="v-name">{teamName(correctTeamId)}</div>
            <div class="v-delta">+{results[correctTeamId].delta}</div>
          </div>
        {:else}
          <div class="verdict bad">
            <div class="v-lead">Ответ не взят</div>
            {#if wrongTeamIds.length}
              <div class="v-sub">Ошиблись: {wrongTeamIds.map(teamName).join(', ')}</div>
            {/if}
          </div>
        {/if}
      {:else if state.currentPrompt}
        <!-- Вопрос на экране -->
        <div class="question">
          <p class="q-text">{state.currentPrompt}</p>
          {#if state.currentType === 'image'}<img src={`/media/${state.packId}/${state.currentMedia}`} alt="" />{/if}
          {#if state.currentType === 'audio'}<audio controls src={`/media/${state.packId}/${state.currentMedia}`}></audio>{/if}
        </div>
      {:else if state.currentQuestionId && !state.revealed}
        <div class="center"><p class="neon">Вопрос выбран</p><p class="muted">ведущий читает…</p></div>
      {:else if currentRound}
        <!-- Поле раунда: категории и клетки (отвеченные отмечены) -->
        <Matrix round={currentRound} usedQuestionIds={state.usedQuestionIds ?? []}
          selectedId={state.currentQuestionId} clickable={false} tv={true} />
      {/if}

      {#if state.buzzQueue?.length}
        <div class="queue neon">Очередь: {queueNames(state)}</div>
      {/if}
    </section>

    <!-- Низ: QR слева + история очков раунда и общий счёт -->
    <footer class="bottom">
      {#if qrSrc}
        <div class="join-qr">
          <img src={qrSrc} alt="QR для входа в игру" />
          <div class="qr-cap">Сканируй — вход в игру</div>
          {#if qrLocal}<div class="qr-warn">Открой табло по IP машины — QR с localhost не сработает на телефонах</div>{/if}
        </div>
      {/if}
      <div class="bottom-main">
        {#if scoreLog.length}
          <div class="history">
            <div class="h-label">История раунда</div>
            <div class="h-list">
              {#each scoreLog as e}
                <div class="h-row" class:ok={e.kind === 'judge' && e.correct} class:bad={e.kind === 'judge' && !e.correct}>
                  <span class="h-mark">{e.kind === 'judge' ? (e.correct ? '✓' : '✗') : '✎'}</span>
                  <span class="h-name">{teamName(e.teamId)}</span>
                  <span class="h-delta">{e.delta > 0 ? '+' : ''}{e.delta}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <Scoreboard teams={state.teams} />
      </div>
    </footer>
  {/if}
</main>

<style>
  /* Фиксированная высота вьюпорта + overflow:hidden — чтобы матрица потеснилась
     под футер (QR/счёт), а не уезжала за край с появлением скролла. */
  main { height: 100vh; overflow: hidden; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem; box-sizing: border-box; }
  .center { display: grid; place-items: center; height: 80vh; text-align: center; }
  .stack { display: flex; flex-direction: column; gap: 2rem; align-items: center; }
  .big { font-size: 3rem; text-align: center; }
  .muted { opacity: .6; }

  .topbar { display: flex; align-items: center; gap: 1rem; }
  .round-chip { border: 1px solid var(--border); border-radius: var(--r-control); padding: 6px 14px; color: var(--text-2); font-size: 1.1rem; }
  .title { font-family: var(--font-display); text-transform: uppercase; font-size: 1.3rem; color: var(--text); }

  .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 1.5rem; justify-content: center; }
  .question { display: grid; place-items: center; gap: 1rem; text-align: center; }
  .q-text { font-size: 2.8rem; line-height: 1.2; }
  .question img { max-width: 60vw; max-height: 45vh; border-radius: var(--r-card); }

  .queue { text-align: center; font-size: 1.2rem; }

  /* Вердикт JUDGED */
  .verdict { display: grid; place-items: center; gap: .6rem; text-align: center; padding: 2rem; }
  .verdict.ok .v-lead { color: var(--ok); }
  .verdict.bad .v-lead { color: var(--err); }
  .v-lead { font-family: var(--font-display); font-size: 3rem; font-weight: 800; }
  .v-name { font-size: 3.5rem; font-weight: 700; }
  .v-delta { font-family: var(--font-display); font-size: 2.4rem; color: var(--ok); }
  .v-sub { font-size: 1.4rem; color: var(--text-2); }

  /* Низ */
  .bottom { display: flex; flex-direction: row; align-items: flex-end; gap: 1.5rem; }
  .bottom-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1rem; }
  .join-qr { flex: none; text-align: center; }
  .join-qr img { width: clamp(120px, 12vw, 200px); height: auto; border-radius: 8px; background: #fff; padding: 6px; display: block; }
  .qr-cap { margin-top: 6px; font-size: .95rem; color: var(--text-2); }
  .qr-warn { margin-top: 4px; font-size: .75rem; color: var(--err); max-width: 200px; line-height: 1.2; }
  .history { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 12px 16px; }
  .h-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; margin-bottom: 8px; }
  .h-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .h-row { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px 10px; font-size: 1rem; }
  .h-row.ok { border-color: var(--ok); }
  .h-row.bad { border-color: var(--err); }
  .h-mark { font-weight: 700; }
  .h-row.ok .h-mark { color: var(--ok); }
  .h-row.bad .h-mark { color: var(--err); }
  .h-delta { color: var(--gold); font-variant-numeric: tabular-nums; }
</style>
