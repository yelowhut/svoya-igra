<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore } from '../lib/store.js';
  import { joinAs } from '../lib/socket.js';
  import Scoreboard from '../lib/Scoreboard.svelte';
  import Matrix from '../lib/Matrix.svelte';
  import { answerSecondsLeft, answerLow, finalSecondsLeft, finalLow } from '../lib/answerTimer.js';
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

  // ── Финал: вспомогательные вычисления ──
  $: finalTeams = (state?.teams ?? []) as { id: string; name: string; score: number }[];
  $: final = state?.final ?? null;
  $: finalThemes = (state?.finalThemes ?? []) as { id: string; name: string }[];
  $: finalQuestion = state?.finalQuestion ?? null;
  // Имя команды чьей ход в фазе вычёркивания
  $: eliminationTurnTeamId = final
    ? (final.eliminationOrder[final.eliminationTurnIndex] ?? null)
    : null;
  $: eliminationTurnName = eliminationTurnTeamId ? teamName(eliminationTurnTeamId) : null;
  // Список команд в порядке раскрытия (eliminationOrder) с данными
  $: revealRows = final
    ? (final.eliminationOrder as string[]).map((tid: string, idx: number) => ({
        tid,
        name: teamName(tid),
        bet: (final.bets as Record<string, number>)[tid] ?? null,
        answerText: (final.answers as Record<string, { text: string; locked: boolean }>)[tid]?.text ?? null,
        revealed: idx < final.revealIndex,
      }))
    : [];

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

  <!-- ══════════════ ФИНАЛ ══════════════ -->

  {:else if state.phase === 'FINAL_INTRO'}
    <!-- Заголовок «Финал» + сетка всех тем -->
    <div class="final-screen">
      <h1 class="neon final-title">ФИНАЛ</h1>
      <div class="theme-grid">
        {#each finalThemes as th}
          <div class="theme-card">{th.name}</div>
        {/each}
      </div>
      <div class="final-footer"><Scoreboard teams={finalTeams} /></div>
    </div>

  {:else if state.phase === 'FINAL_ELIMINATION'}
    <!-- Темы: вычеркнутые затемнены; подсветка команды чьей ход -->
    <div class="final-screen">
      <h1 class="neon final-title">ФИНАЛ — Выбор темы</h1>
      {#if eliminationTurnName}
        <div class="elim-turn">Выбирает: <span class="elim-name">{eliminationTurnName}</span></div>
      {/if}
      <div class="theme-grid">
        {#each finalThemes as th}
          {@const active = (final?.themeIds ?? []).includes(th.id)}
          <div class="theme-card" class:elim-out={!active}>{th.name}</div>
        {/each}
      </div>
      <div class="final-footer"><Scoreboard teams={finalTeams} /></div>
    </div>

  {:else if state.phase === 'FINAL_BETTING'}
    <!-- Ставки: кто уже поставил -->
    <div class="final-screen">
      <h1 class="neon final-title">Команды делают ставки</h1>
      <div class="bet-list">
        {#each finalTeams as t}
          {@const placed = (final?.betPlaced ?? []).includes(t.id)}
          <div class="bet-row" class:bet-done={placed}>
            <span class="bet-team">{t.name}</span>
            <span class="bet-status">{placed ? '✓ Ставка сделана' : '…ждём'}</span>
          </div>
        {/each}
      </div>
      <div class="final-footer"><Scoreboard teams={finalTeams} /></div>
    </div>

  {:else if state.phase === 'FINAL_QUESTION'}
    <!-- Вопрос + таймер + кто готов -->
    <div class="final-screen">
      {#if finalQuestion}
        <div class="question">
          <p class="q-text">{finalQuestion.prompt}</p>
          {#if finalQuestion.type === 'image' && finalQuestion.media}
            <img src={`/media/${state.packId}/${finalQuestion.media}`} alt="" />
          {/if}
          {#if finalQuestion.type === 'audio' && finalQuestion.media}
            <audio controls src={`/media/${state.packId}/${finalQuestion.media}`}></audio>
          {/if}
        </div>
      {:else}
        <div class="center"><p class="neon">Вопрос финала</p></div>
      {/if}
      <div class="fq-bottom">
        <div class="fq-timer" class:low={$finalLow}>
          {$finalSecondsLeft ?? '—'} <span class="fq-sec">сек</span>
        </div>
        <div class="fq-ready">
          {#each finalTeams as t}
            {@const locked = (final?.answerLocked ?? []).includes(t.id)}
            <div class="fq-team" class:fq-locked={locked}>
              <span>{t.name}</span>
              {#if locked}<span class="fq-lock">✓ готов</span>{/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

  {:else if state.phase === 'FINAL_REVEAL'}
    <!-- Вскрытие: ответы + ставки по мере revealIndex -->
    <div class="final-screen">
      <h1 class="neon final-title">Финал — Вскрытие</h1>
      <div class="reveal-list">
        {#each revealRows as row}
          <div class="reveal-row" class:revealed={row.revealed}>
            <span class="reveal-name">{row.name}</span>
            {#if row.revealed}
              <span class="reveal-bet">Ставка: {row.bet ?? '—'}</span>
              <span class="reveal-answer">{row.answerText ?? '—'}</span>
            {:else}
              <span class="reveal-hidden">…</span>
            {/if}
          </div>
        {/each}
      </div>
      <div class="final-footer"><Scoreboard teams={finalTeams} /></div>
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

  /* Отвечает команда + крупный отсчёт (ANSWERING) */
  .board-answer { display: grid; place-items: center; gap: 1rem; text-align: center; padding: 2rem; }
  .ba-lead { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .12em;
    font-size: 1.6rem; color: var(--text-2); }
  .ba-name { font-family: var(--font-display); font-weight: 800; text-transform: uppercase;
    font-size: clamp(3rem, 7vw, 6rem); line-height: 1; color: var(--accent); }
  .ba-time { font-family: var(--font-display); font-size: 2rem; color: var(--text-2); }
  .ba-time span { font-weight: 800; font-size: 1.4em; color: var(--gold); font-variant-numeric: tabular-nums; }
  .ba-time.low span { color: var(--err); }

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

  /* ══════════════ ФИНАЛ ══════════════ */
  .final-screen {
    height: 100vh; overflow: hidden;
    display: flex; flex-direction: column; gap: 1.5rem;
    padding: 2rem; box-sizing: border-box;
  }
  .final-title {
    font-family: var(--font-display); text-transform: uppercase;
    font-size: clamp(2rem, 5vw, 4rem); text-align: center; margin: 0;
    letter-spacing: .06em;
  }
  .final-footer { margin-top: auto; }

  /* Сетка тем — INTRO + ELIMINATION */
  .theme-grid {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(180px, 18vw, 320px), 1fr));
    gap: clamp(6px, 1vw, 16px);
    align-content: start;
  }
  .theme-card {
    background: var(--cell); border: 1px solid var(--border-accent);
    border-radius: var(--r-card); padding: clamp(12px, 2vw, 28px);
    font-family: var(--font-display); font-weight: 600;
    font-size: clamp(1.1rem, 2.2vw, 2rem); text-align: center;
    display: flex; align-items: center; justify-content: center;
    text-transform: uppercase; letter-spacing: .03em;
    transition: opacity .3s, color .3s;
  }
  .theme-card.elim-out {
    opacity: .25; color: var(--text-3);
    text-decoration: line-through;
    border-color: var(--border);
  }

  /* Вычёркивание — чей ход */
  .elim-turn {
    text-align: center; font-size: clamp(1.2rem, 2.5vw, 2rem);
    color: var(--text-2);
  }
  .elim-name {
    font-family: var(--font-display); font-weight: 700;
    color: var(--gold); font-size: 1.1em;
  }

  /* Ставки */
  .bet-list {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column; gap: clamp(8px, 1.2vw, 18px);
    justify-content: center;
  }
  .bet-row {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--r-card); padding: clamp(10px, 1.5vw, 22px) clamp(16px, 2.5vw, 36px);
    font-size: clamp(1.1rem, 2.2vw, 1.8rem);
    transition: border-color .2s;
  }
  .bet-row.bet-done {
    border-color: var(--ok);
  }
  .bet-team {
    font-family: var(--font-display); font-weight: 600; color: var(--text);
  }
  .bet-status {
    font-size: .85em; color: var(--text-2);
  }
  .bet-row.bet-done .bet-status {
    color: var(--ok);
  }

  /* Вопрос финала + таймер + кто готов */
  .fq-bottom {
    display: flex; align-items: flex-end; gap: 2rem; flex-wrap: wrap;
  }
  .fq-timer {
    font-family: var(--font-display); font-size: clamp(3rem, 10vw, 8rem);
    font-weight: 800; color: var(--accent); line-height: 1;
    flex: none;
    transition: color .2s;
  }
  .fq-timer.low { color: var(--err); }
  .fq-sec { font-size: .45em; color: var(--text-2); }
  .fq-ready {
    flex: 1; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  }
  .fq-team {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--r-control);
    padding: 6px 14px; font-size: clamp(.9rem, 1.5vw, 1.3rem);
    color: var(--text-2); transition: border-color .2s, color .2s;
  }
  .fq-team.fq-locked {
    border-color: var(--ok); color: var(--text);
  }
  .fq-lock { color: var(--ok); font-size: .9em; }

  /* Вскрытие */
  .reveal-list {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column; gap: clamp(8px, 1.2vw, 18px);
    justify-content: center;
  }
  .reveal-row {
    display: flex; align-items: center; gap: clamp(12px, 2vw, 28px);
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--r-card); padding: clamp(10px, 1.5vw, 22px) clamp(16px, 2.5vw, 36px);
    font-size: clamp(1rem, 1.8vw, 1.5rem);
    opacity: .5; transition: opacity .3s, border-color .3s;
  }
  .reveal-row.revealed {
    opacity: 1; border-color: var(--accent);
  }
  .reveal-name {
    font-family: var(--font-display); font-weight: 700; color: var(--text);
    min-width: clamp(8rem, 14vw, 18rem);
  }
  .reveal-bet {
    color: var(--gold); font-variant-numeric: tabular-nums;
    font-family: var(--font-display); font-size: .9em;
    min-width: 8rem;
  }
  .reveal-answer {
    flex: 1; color: var(--text-accent); font-size: 1em;
  }
  .reveal-hidden {
    flex: 1; color: var(--text-4); font-size: 1.5em; letter-spacing: .2em;
  }
</style>
