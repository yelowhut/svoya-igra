<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import Matrix from '../../lib/Matrix.svelte';
  import Scoreboard from '../../lib/Scoreboard.svelte';
  import { workingGameId } from '../store.js';
  import { answerSecondsLeft, answerLow } from '../../lib/answerTimer.js';
  import { fmtMs } from '../../lib/format.js';
  import { gameExists } from '../gameApi.js';
  import { navigate } from '../router.js';

  let state: any = null; $: state = $gameStore;
  let gameId: string | null = null; $: gameId = $workingGameId;
  let packRounds: any[] = [];
  let deltasInput: Record<string, string> = {};
  let auctionBids: Record<string, string> = {};

  onMount(async () => {
    if (!gameId) return;
    const ok = await gameExists(gameId).then(r => r.exists).catch(() => false);
    if (!ok) { workingGameId.set(null); return; }  // игра исчезла (БД пересоздана) — на лобби
    joinAs(gameId, 'host');
  });

  // загрузить структуру пака для матрицы, когда известен packId
  let loadedPackId = '';
  let packMissing = false;
  $: if (state?.packId && state.packId !== loadedPackId) {
    loadedPackId = state.packId;
    packMissing = false;
    // Пак мог быть удалён (снят с публикации), а игра на него ещё ссылается —
    // не валим пульт из-за 404: показываем уведомление, матрица пустая.
    fetch(`/api/packs/${state.packId}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => { packRounds = p?.rounds ?? []; packMissing = !p; })
      .catch(() => { packRounds = []; packMissing = true; });
  }

  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0] ?? null;
  $: answeringTeam = state?.teams?.find((t: any) => t.id === state.answeringTeamId);
  $: auctionLeaderTeam = state?.teams?.find((t: any) => t.id === state.auction?.leaderTeamId);
  // Активные команды (есть подключённый игрок) и те, кто ещё не нажал в BUZZER_OPEN
  $: activeTeams = (state?.teams ?? []).filter((t: any) => (state?.players ?? []).some((p: any) => p.connected && p.teamId === t.id));
  $: pendingTeams = state?.phase === 'BUZZER_OPEN'
    ? activeTeams.filter((t: any) => !(state.buzzQueue ?? []).some((b: any) => b.teamId === t.id))
    : [];
  $: pendingNames = pendingTeams.map((t: any) => t.name).join(', ');

  function resetRound() {
    if (confirm('Сбросить раунд? Все клетки снова станут доступны (счёт команд сохранится).')) hostAction('resetRound');
  }

  function openBoard() {
    if (gameId) window.open(`/board?game=${encodeURIComponent(gameId)}`, '_blank');
  }

  function teamName(teamId: string): string { return state?.teams?.find((t: any) => t.id === teamId)?.name ?? teamId; }
  function adjustScore(teamId: string, delta: number) { hostAction('adjustScore', { teamId, delta }); }
  function adjustByDeltaInput(teamId: string) {
    const delta = parseInt(deltasInput[teamId] ?? '0', 10);
    if (!isNaN(delta) && delta !== 0) { adjustScore(teamId, delta); deltasInput[teamId] = ''; }
  }

  async function endGame() {
    hostAction('endGame');           // сервер авто-деактивирует указатель
    workingGameId.set(null);
    navigate('lobby');
  }
</script>

<section class="pult">
  {#if !gameId}
    <div class="empty">Нет активной игры. Создайте или выберите игру в разделе «Лобби и команды».
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if !state}
    <p class="muted">Подключение к игре…</p>
  {:else if state.phase === 'GAME_END'}
    <h1 class="screen-title">Игра окончена</h1>
    <Scoreboard teams={state.teams} />
    <button class="primary" on:click={() => { workingGameId.set(null); navigate('lobby'); }}>К лобби</button>
  {:else if state.phase === 'LOBBY'}
    <div class="empty">Игра ещё в лобби. Перейдите в «Лобби и команды», чтобы начать раунд.
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if state.phase === 'ROUND_END'}
    <h1 class="screen-title">Итоги раунда {state.roundIndex + 1}</h1>
    <Scoreboard teams={state.teams} />
    {#if state.roundIndex + 1 < packRounds.length}
      <button class="primary" on:click={() => hostAction('startRound', { roundIndex: state.roundIndex + 1 })}>Следующий раунд →</button>
    {:else}
      <button class="primary" on:click={endGame}>Завершить игру</button>
    {/if}
  {:else}
    <!-- ЖИВАЯ ИГРА -->
    <div class="head">
      <h1 class="screen-title">{state.title}</h1>
      <span class="round-chip">Раунд {state.roundIndex + 1}</span>
      <span class="timer-chip">Ответ {state.answerTimerSec ?? 45} с</span>
      <button class="ghost" on:click={resetRound}>Сбросить раунд</button>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
      <button class="ghost tv" on:click={openBoard}>📺 Открыть ТВ</button>
    </div>

    {#if packMissing}
      <div class="pack-missing">Пак этой игры удалён или снят с публикации — поле вопросов недоступно. Завершите игру и создайте новую на актуальном паке.</div>
    {/if}

    <div class="cols">
      <div class="left">
        <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
          selectedId={state?.currentQuestionId}
          clickable={state?.phase === 'PICKING'}
          on:select={(e) => hostAction('selectQuestion', e.detail)} />

        {#if state?.currentPrompt}
          <div class="qcard">
            <div class="qtext">{state.currentPrompt}</div>
            <div class="answer">Ответ: {state.currentAnswer}</div>
          </div>
        {/if}
      </div>

      <div class="right">
        {#if state?.buzzQueue?.length || state?.phase === 'BUZZER_OPEN'}
          <div class="panel">
            <div class="panel-label">Очередь нажатий · история</div>
            {#each state.buzzQueue ?? [] as entry, i}
              {@const res = state.questionResults?.[entry.teamId]}
              <div class="queue-row" class:answering={entry.teamId === state.answeringTeamId}>
                <span class="q-name">{i + 1}. {teamName(entry.teamId)}</span>
                <span class="q-ms">{fmtMs(Math.max(0, entry.reaction))}</span>
                <span class="q-verdict" class:ok={res?.correct} class:bad={res && !res.correct}>{res ? (res.correct ? '✓' : '✗') : ''}</span>
              </div>
            {/each}
            {#if state?.phase === 'BUZZER_OPEN'}
              {#if pendingTeams.length}
                <div class="q-pending">Ждём: {pendingNames}</div>
              {:else if activeTeams.length}
                <div class="q-pending ok">Все команды нажали — можно начинать ответы</div>
              {/if}
            {/if}
          </div>
        {/if}

        {#if state.currentSpecial === 'auction'}
          <div class="panel gold">
            <div class="panel-label">Аукцион</div>
            {#if state.auction}<div>Ставка: <strong>{state.auction.highestBid}</strong>{#if auctionLeaderTeam} — {auctionLeaderTeam.name}{/if}</div>{/if}
            {#each (state.teams ?? []) as team}
              <div class="bid-row">
                <span>{team.name}</span>
                <input type="number" min="0" bind:value={auctionBids[team.id]} />
                <button class="ghost" on:click={() => { const a = Number(auctionBids[team.id]); if (!isNaN(a)) hostAction('auctionBid', { teamId: team.id, amount: a }); }}>Ставка</button>
              </div>
            {/each}
            {#if state.auction?.leaderTeamId}
              <button class="primary" on:click={() => hostAction('auctionWon', { teamId: state.auction.leaderTeamId, amount: state.auction.highestBid })}>Победитель: {auctionLeaderTeam?.name ?? ''}</button>
            {/if}
          </div>
        {:else if state.currentSpecial === 'cat'}
          <div class="panel">
            <div class="panel-label">Кот в мешке — передать команде</div>
            {#each (state.teams ?? []) as team}
              {#if team.id !== state.pickingTeamId}
                <button class="ghost" on:click={() => hostAction('catAssign', { toTeamId: team.id })}>{team.name}</button>
              {/if}
            {/each}
          </div>
        {:else if state?.currentPrompt}
          <div class="panel">
            {#if !state.revealed}
              <div class="flow-hint">Вопрос ещё не показан игрокам</div>
              <button class="primary" on:click={() => hostAction('reveal')}>Прочитать вопрос</button>
            {:else if state.phase === 'QUESTION'}
              <button class="primary" on:click={() => hostAction('arm')}>Приготовиться</button>
            {:else if state.phase === 'BUZZER_ARMED'}
              <div class="flow-hint">Игроки видят «приготовьтесь». Ранний жим = фальстарт.</div>
              <button class="primary" on:click={() => hostAction('open')}>Открыть баззер (GO)</button>
            {:else if state.phase === 'BUZZER_OPEN'}
              <button class="primary" on:click={() => hostAction('startAnswers')} disabled={!state.buzzQueue?.length}>Начать ответы досрочно</button>
            {/if}
            <button class="ghost" on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
          </div>
        {/if}

        {#if answeringTeam}
          <div class="panel">
            <div class="answering-banner">Отвечает {answeringTeam.name}</div>
            <div class="timer-row">
              <span class="timer-badge" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</span>
              <span class="timer-cap">секунд на ответ. На нуле ответ не засчитан — ход следующему в очереди.</span>
            </div>
            <div class="timer-ctl">
              {#if state.answerPausedRemainingMs != null}
                <button class="ghost" on:click={() => hostAction('timerResume')}>▶ Продолжить</button>
              {:else}
                <button class="ghost" on:click={() => hostAction('timerPause')}>⏸ Пауза</button>
              {/if}
              <button class="ghost" on:click={() => hostAction('timerReset')}>↻ Сброс</button>
            </div>
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>✕ Неверно</button>
            </div>
          </div>
        {/if}

        <div class="panel">
          <div class="panel-label">Счёт · быстрая правка ±100</div>
          {#each (state.teams ?? []) as team}
            <div class="score-row" class:answering={team.id === state.answeringTeamId}>
              <span class="sname">{team.name}</span>
              <span class="sval">{team.score}</span>
              <button class="icon" on:click={() => adjustScore(team.id, -100)}>−100</button>
              <button class="icon" on:click={() => adjustScore(team.id, 100)}>+100</button>
              <input type="number" placeholder="Δ" bind:value={deltasInput[team.id]} />
              <button class="icon" on:click={() => adjustByDeltaInput(team.id)}>OK</button>
            </div>
          {/each}
        </div>

        <button class="ghost" on:click={() => hostAction('endRound')}>Конец раунда</button>
      </div>
    </div>

    {#if $lastError}
      <div class="err-bar"><span>{$lastError}</span><button on:click={() => lastError.set('')}>×</button></div>
    {/if}
  {/if}
</section>

<style>
  /* СТРУКТУРА. Двухколоночная плотная раскладка — выровнять по прототипу §5.6.
     Цвета/радиусы — из theme.css. */
  .pult { display: flex; flex-direction: column; gap: 16px; }
  .screen-title { font-family: var(--font-display); text-transform: uppercase; margin: 0; }
  .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pack-missing { background: #2d0a0a; border: 1px solid var(--err); color: var(--err);
    border-radius: var(--r-control); padding: 10px 14px; font-size: 14px; }
  .round-chip, .timer-chip { border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px 10px; color: var(--text-2); font-size: 13px; }
  .timer-chip { color: var(--gold); }
  .cols { display: grid; grid-template-columns: 1fr 360px; gap: 16px; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  .left { display: flex; flex-direction: column; gap: 12px; }
  .right { display: flex; flex-direction: column; gap: 12px; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .panel.gold { border-color: var(--gold); }
  .panel-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  .qcard { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .qtext { font-size: 22px; }
  .answer { margin-top: 10px; color: var(--gold); border: 1px dashed var(--gold); border-radius: var(--r-control); padding: 8px 12px; }
  .queue-row { padding: 6px 8px; border-radius: var(--r-control);
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .queue-row.answering { background: var(--cell-hover); color: var(--text); font-weight: 700; }
  .q-name { text-align: left; }
  .q-ms { color: var(--gold); font-variant-numeric: tabular-nums; text-align: center; }
  .q-verdict { text-align: right; font-weight: 700; font-size: 16px; }
  .q-verdict.ok { color: var(--ok); }
  .q-verdict.bad { color: var(--err); }
  .q-pending { font-size: 12px; color: var(--text-2); padding: 4px 8px; }
  .q-pending.ok { color: var(--ok); }
  .flow-hint { font-size: 12px; color: var(--text-3); line-height: 1.4; }
  .answering-banner { color: var(--ok); font-family: var(--font-display); }
  .judge { display: flex; gap: 10px; }
  .judge-yes { flex: 1; background: var(--ok); color: #042; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .judge-no { flex: 1; background: var(--err); color: #fff; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .score-row { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
  .score-row.answering { outline: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 4px; }
  .sname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sval { color: var(--gold); min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
  .score-row input { width: 50px; }
  .score-row .icon { padding: 6px 7px; }
  .bid-row { display: flex; align-items: center; gap: 6px; }
  input { height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; width: 72px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .empty { background: var(--panel); border: 1px dashed var(--border); border-radius: var(--r-card); padding: 24px; color: var(--text-2); display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .muted { color: var(--text-2); }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; }
  .ghost.danger { border-color: var(--err); color: var(--err); }
  .ghost.tv { margin-left: auto; }
  .timer-row { display: flex; align-items: center; gap: 12px; }
  .timer-badge { flex: none; min-width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
    border-radius: 12px; background: rgba(245,197,24,.12); border: 1px solid rgba(245,197,24,.4);
    font-family: var(--font-display); font-weight: 700; font-size: 26px; color: var(--gold); }
  .timer-badge.low { background: rgba(255,77,77,.16); border-color: rgba(255,77,77,.55); color: var(--err); }
  .timer-cap { font-size: 12px; color: var(--text-2); line-height: 1.4; }
  .timer-ctl { display: flex; gap: 8px; }
</style>
