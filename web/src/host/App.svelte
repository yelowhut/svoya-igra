<script lang="ts">
  import { gameStore } from '../lib/store.js';
  import { joinAs, hostAction } from '../lib/socket.js';
  import Matrix from '../lib/Matrix.svelte';
  import Scoreboard from '../lib/Scoreboard.svelte';

  let step: 'setup'|'live' = 'setup';
  let packId = '', title = '', teamCount = 2, gameId = '';
  let packRounds: any[] = [];
  let state: any = null; $: state = $gameStore;

  async function uploadPack(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/packs', { method: 'POST', body: fd }).then(r => r.json());
    packId = r.packId; if (!title) title = r.title;
  }
  async function createGame() {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packId, title, teamCount }) }).then(r => r.json());
    gameId = r.gameId;
    // загрузим структуру пака для матрицы
    packRounds = (await fetch(`/api/packs/${packId}`).then(r => r.json())).rounds;
    joinAs(gameId, 'host');
    for (let i = 0; i < teamCount; i++) hostAction('createTeam', { name: `Команда ${i+1}` });
    step = 'live';
  }
  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0];
  $: answeringTeam = state?.teams?.find((t:any) => t.id === state.answeringTeamId);
</script>

{#if step === 'setup'}
  <main style="padding:2rem;display:grid;gap:1rem;max-width:30rem">
    <h1 class="neon">Создать игру</h1>
    <label>Пак (.zip): <input type="file" accept=".zip" on:change={uploadPack} /></label>
    <input placeholder="Название игры" bind:value={title} />
    <label>Команд: <input type="number" min="2" max="8" bind:value={teamCount} /></label>
    <button class="neon" disabled={!packId || !title} on:click={createGame}>Создать</button>
  </main>
{:else}
  <main style="padding:1rem;display:grid;gap:1rem">
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <h1 class="neon" style="margin:0">{title}</h1>
      <span>Игрок: <code>/play?game={gameId}</code></span>
      <span>Табло: <code>/board?game={gameId}</code></span>
    </div>

    {#if state?.phase === 'LOBBY'}
      <Scoreboard teams={state.teams} />
      <button class="neon" on:click={() => hostAction('startRound', { roundIndex: 0 })}>Начать игру</button>
    {:else}
      <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
        clickable={state?.phase === 'PICKING'}
        on:select={(e) => hostAction('selectQuestion', e.detail)} />

      {#if state?.currentPrompt}
        <div style="background:var(--panel);padding:1rem;border-radius:.5rem;font-size:1.5rem">{state.currentPrompt}</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button on:click={() => hostAction('arm')}>Зарядить</button>
          <button on:click={() => hostAction('open')}>Открыть buzzer</button>
          <button on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
        </div>
        {#if answeringTeam}
          <div class="neon">Отвечает: {answeringTeam.name}</div>
          <div style="display:flex;gap:.5rem">
            <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>ВЕРНО ✅</button>
            <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>НЕВЕРНО ❌</button>
          </div>
        {/if}
        <div style="position:fixed;bottom:0;left:0;right:0;background:#000;color:var(--muted);font-size:.8rem;padding:.25rem 1rem">
          Ответ: {state.currentAnswer}
        </div>
      {/if}

      <Scoreboard teams={state.teams} />
      <div style="display:flex;gap:.5rem">
        <button on:click={() => hostAction('endRound')}>Конец раунда</button>
        <button on:click={() => hostAction('endGame')}>Конец игры</button>
      </div>
    {/if}
  </main>
{/if}
