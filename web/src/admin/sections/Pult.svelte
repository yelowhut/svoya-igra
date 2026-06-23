<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import Matrix from '../../lib/Matrix.svelte';
  import Scoreboard from '../../lib/Scoreboard.svelte';
  import { workingGameId, answerTimerSec } from '../store.js';
  import { deactivateGame, gameExists } from '../gameApi.js';
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
  $: if (state?.packId && state.packId !== loadedPackId) {
    loadedPackId = state.packId;
    fetch(`/api/packs/${state.packId}`).then(r => r.json()).then(p => { packRounds = p.rounds; }).catch(() => {});
  }

  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0];
  $: answeringTeam = state?.teams?.find((t: any) => t.id === state.answeringTeamId);
  $: auctionLeaderTeam = state?.teams?.find((t: any) => t.id === state.auction?.leaderTeamId);

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
      <span class="timer-chip">Ответ {$answerTimerSec} с</span>
      <button class="ghost" on:click={() => hostAction('closeQuestion')}>Сбросить раунд</button>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>

    <div class="cols">
      <div class="left">
        <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
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
        {#if state?.buzzQueue?.length}
          <div class="panel">
            <div class="panel-label">Очередь buzzer</div>
            {#each state.buzzQueue as entry, i}
              <div class="queue-row" class:answering={entry.teamId === state.answeringTeamId}>{i + 1}. {teamName(entry.teamId)}</div>
            {/each}
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
            <button class="primary" on:click={() => hostAction('arm')}>Зарядить</button>
            <button class="primary" on:click={() => hostAction('open')}>Открыть buzzer</button>
            <button class="ghost" on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
          </div>
        {/if}

        {#if answeringTeam}
          <div class="panel">
            <div class="answering-banner">Отвечает {answeringTeam.name}</div>
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>✕ Неверно</button>
            </div>
          </div>
        {/if}

        <div class="panel">
          <div class="panel-label">Счёт · правка ±100</div>
          {#each (state.teams ?? []) as team}
            <div class="score-row" class:answering={team.id === state.answeringTeamId}>
              <span class="sname">{team.name}</span>
              <span class="sval">{team.score}</span>
              <button class="icon" on:click={() => adjustScore(team.id, -(state.currentValue || 100))}>−{state.currentValue || 100}</button>
              <button class="icon" on:click={() => adjustScore(team.id, state.currentValue || 100)}>+{state.currentValue || 100}</button>
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
  .queue-row { padding: 6px 8px; border-radius: var(--r-control); }
  .queue-row.answering { background: var(--cell-hover); color: var(--text); font-weight: 700; }
  .answering-banner { color: var(--ok); font-family: var(--font-display); }
  .judge { display: flex; gap: 10px; }
  .judge-yes { flex: 1; background: var(--ok); color: #042; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .judge-no { flex: 1; background: var(--err); color: #fff; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .score-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .score-row.answering { outline: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 4px; }
  .sname { min-width: 120px; } .sval { color: var(--gold); min-width: 48px; }
  .bid-row { display: flex; align-items: center; gap: 6px; }
  input { height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; width: 72px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .empty { background: var(--panel); border: 1px dashed var(--border); border-radius: var(--r-card); padding: 24px; color: var(--text-2); display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .muted { color: var(--text-2); }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; }
  .ghost.danger { border-color: var(--err); color: var(--err); }
</style>
