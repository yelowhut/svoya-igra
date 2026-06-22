<script lang="ts">
  import { gameStore } from '../lib/store.js';
  import { joinAs, hostAction } from '../lib/socket.js';
  import Matrix from '../lib/Matrix.svelte';
  import Scoreboard from '../lib/Scoreboard.svelte';

  let step: 'setup'|'live' = 'setup';
  let packId = '', title = '', teamCount = 2, gameId = '';
  let packRounds: any[] = [];
  let state: any = null; $: state = $gameStore;

  // arbitrary delta inputs per team: teamId -> string
  let deltasInput: Record<string, string> = {};

  // auction bid inputs per team: teamId -> string
  let auctionBids: Record<string, string> = {};

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
  $: auctionLeaderTeam = state?.teams?.find((t:any) => t.id === state.auction?.leaderTeamId);

  function teamName(teamId: string): string {
    return state?.teams?.find((t:any) => t.id === teamId)?.name ?? teamId;
  }

  function adjustScore(teamId: string, delta: number) {
    hostAction('adjustScore', { teamId, delta });
  }

  function adjustByDeltaInput(teamId: string) {
    const delta = parseInt(deltasInput[teamId] ?? '0', 10);
    if (!isNaN(delta) && delta !== 0) {
      adjustScore(teamId, delta);
      deltasInput[teamId] = '';
    }
  }
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

    {#if state?.phase === 'GAME_END'}
      <!-- === КОНЕЦ ИГРЫ === -->
      <h2 class="neon" style="text-align:center">Игра окончена!</h2>
      <Scoreboard teams={state.teams} />

    {:else if state?.phase === 'ROUND_END'}
      <!-- === КОНЕЦ РАУНДА — итоги + кнопка следующего раунда === -->
      <h2 class="neon">Итоги раунда {state.roundIndex + 1}</h2>
      <Scoreboard teams={state.teams} />
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
        {#if state.roundIndex + 1 < packRounds.length}
          <button class="neon" on:click={() => hostAction('startRound', { roundIndex: state.roundIndex + 1 })}>
            Следующий раунд →
          </button>
        {:else}
          <button class="neon" on:click={() => hostAction('endGame')}>Завершить игру</button>
        {/if}
      </div>

    {:else if state?.phase === 'LOBBY'}
      <!-- === ЛОББИ === -->
      <Scoreboard teams={state.teams} />

      <!-- Ростер игроков по командам -->
      {#if (state.players ?? []).length > 0}
        <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem">
          <div style="font-weight:700;margin-bottom:.5rem;color:var(--neon)">Игроки</div>
          <div style="display:flex;flex-direction:column;gap:.25rem">
            {#each (state.players ?? []) as player}
              <div style="display:flex;align-items:center;gap:.5rem;font-size:.9rem">
                <span style="font-size:.7rem;color:{player.connected ? '#4ade80' : '#6b7280'}">{player.connected ? '●' : '○'}</span>
                <span>{player.firstName} {player.lastName}</span>
                <span style="color:var(--muted);font-size:.8rem">— {teamName(player.teamId)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <button class="neon" on:click={() => hostAction('startRound', { roundIndex: 0 })}>Начать игру</button>

    {:else if state}
      <!-- === ИГРА (PICKING / QUESTION / BUZZER_ARMED / BUZZER_OPEN / ANSWERING / JUDGED) === -->
      <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
        clickable={state?.phase === 'PICKING'}
        on:select={(e) => hostAction('selectQuestion', e.detail)} />

      <!-- Buzz-очередь -->
      {#if state?.buzzQueue?.length}
        <div style="background:var(--panel);border-radius:.5rem;padding:.5rem 1rem">
          <span style="color:var(--muted);font-size:.85rem">Очередь ответов: </span>
          {#each state.buzzQueue as entry, i}
            <span style="
              display:inline-block;margin:.15rem .3rem;padding:.2rem .6rem;border-radius:.3rem;
              background:{entry.teamId === state.answeringTeamId ? 'var(--neon)' : 'var(--panel)'};
              color:{entry.teamId === state.answeringTeamId ? '#000' : 'var(--neon)'};
              border:1px solid var(--neon);font-weight:{entry.teamId === state.answeringTeamId ? 800 : 400}">
              {i+1}. {teamName(entry.teamId)}
            </span>
          {/each}
        </div>
      {/if}

      {#if state?.currentPrompt}
        <!-- Текст вопроса -->
        <div style="background:var(--panel);padding:1rem;border-radius:.5rem;font-size:1.5rem">{state.currentPrompt}</div>

        <!-- ====== КОНТРОЛЫ ПО ТИПУ СПЕЦВОПРОСА ====== -->
        {#if state.currentSpecial === 'auction'}
          <!-- АУКЦИОН: нет buzzer-кнопок, только ставки -->
          <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem;border:1px solid var(--gold)">
            <div style="color:var(--gold);font-weight:700;margin-bottom:.5rem">Аукцион</div>
            {#if state.auction}
              <div style="margin-bottom:.5rem;font-size:.9rem">
                Наибольшая ставка: <strong style="color:var(--gold)">{state.auction.highestBid}</strong>
                {#if auctionLeaderTeam} — {auctionLeaderTeam.name}{/if}
              </div>
            {/if}
            <!-- Ставки по командам -->
            <div style="display:flex;flex-direction:column;gap:.4rem">
              {#each (state.teams ?? []) as team}
                <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                  <span style="min-width:8rem;font-size:.9rem">{team.name}</span>
                  <input type="number" min="0" placeholder="Сумма"
                    bind:value={auctionBids[team.id]}
                    style="width:6rem;background:#111;color:var(--neon);border:1px solid var(--neon);border-radius:.3rem;padding:.2rem .5rem" />
                  <button style="font-size:.8rem" on:click={() => {
                    const amt = Number(auctionBids[team.id]);
                    if (!isNaN(amt)) hostAction('auctionBid', { teamId: team.id, amount: amt });
                  }}>Ставка</button>
                </div>
              {/each}
            </div>
            <!-- Объявить победителя аукциона -->
            {#if state.auction?.leaderTeamId}
              <button class="neon" style="margin-top:.75rem" on:click={() =>
                hostAction('auctionWon', { teamId: state.auction.leaderTeamId, amount: state.auction.highestBid })}>
                Объявить победителя: {auctionLeaderTeam?.name ?? ''}
              </button>
            {/if}
          </div>

          <!-- После auctionWon: answeringTeam появляется, показываем судейские кнопки -->
          {#if answeringTeam}
            <div class="neon">Отвечает: {answeringTeam.name}</div>
            <div style="display:flex;gap:.5rem">
              <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>ВЕРНО ✅</button>
              <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>НЕВЕРНО ❌</button>
            </div>
          {/if}
          <button on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>

        {:else if state.currentSpecial === 'cat'}
          <!-- КОТ В МЕШКЕ: выбрать команду-получателя -->
          <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem;border:1px solid var(--neon)">
            <div style="color:var(--neon);font-weight:700;margin-bottom:.5rem">Кот в мешке — передать команде:</div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap">
              {#each (state.teams ?? []) as team}
                {#if team.id !== state.pickingTeamId}
                  <button on:click={() => hostAction('catAssign', { toTeamId: team.id })}>{team.name}</button>
                {/if}
              {/each}
            </div>
          </div>

          <!-- После catAssign: answeringTeam = assignedTeam -->
          {#if answeringTeam}
            <div class="neon">Отвечает: {answeringTeam.name}</div>
            <div style="display:flex;gap:.5rem">
              <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>ВЕРНО ✅</button>
              <button on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>НЕВЕРНО ❌</button>
            </div>
          {/if}
          <button on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>

        {:else}
          <!-- ОБЫЧНЫЙ ВОПРОС (special === 'none') -->
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
        {/if}

        <!-- Ответ (host-only, фиксированная панель внизу) -->
        <div style="position:fixed;bottom:0;left:0;right:0;background:#000;color:var(--muted);font-size:.8rem;padding:.25rem 1rem">
          Ответ: {state.currentAnswer}
        </div>
      {/if}

      <Scoreboard teams={state.teams} />

      <!-- Правка очков (MVP undo) -->
      <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem">
        <div style="font-weight:700;margin-bottom:.5rem;color:var(--muted);font-size:.85rem">Правка очков</div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          {#each (state.teams ?? []) as team}
            <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
              <span style="min-width:8rem;font-size:.9rem">{team.name}</span>
              <button style="font-size:.8rem;padding:.2rem .5rem" on:click={() => adjustScore(team.id, -(state.currentValue || 100))}>−{state.currentValue || 100}</button>
              <button style="font-size:.8rem;padding:.2rem .5rem" on:click={() => adjustScore(team.id, state.currentValue || 100)}>+{state.currentValue || 100}</button>
              <input type="number" placeholder="Δ" bind:value={deltasInput[team.id]}
                style="width:5rem;background:#111;color:var(--neon);border:1px solid var(--neon);border-radius:.3rem;padding:.2rem .4rem" />
              <button style="font-size:.8rem;padding:.2rem .5rem" on:click={() => adjustByDeltaInput(team.id)}>Применить</button>
            </div>
          {/each}
        </div>
      </div>

      <div style="display:flex;gap:.5rem;margin-top:.25rem">
        <button on:click={() => hostAction('endRound')}>Конец раунда</button>
        <button on:click={() => hostAction('endGame')}>Конец игры</button>
      </div>

    {:else}
      <!-- состояние ещё не пришло от сервера -->
      <p style="color:var(--muted)">Подключение к игре…</p>
    {/if}
  </main>
{/if}
