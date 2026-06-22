<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../lib/store.js';
  import { joinAs, hostAction } from '../lib/socket.js';
  import { isValidTeamName } from '../lib/teamName.js';
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

  // --- resume banner ---
  let resumeData: { gameId: string; packId: string; title: string } | null = null;

  onMount(async () => {
    const raw = localStorage.getItem('svoya:host');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { gameId: string; packId: string; title: string };
      if (!parsed.gameId || !parsed.packId) return;
      const r = await fetch(`/api/games/${parsed.gameId}/exists`).then(res => res.json()).catch(() => ({ exists: false }));
      if (r.exists) {
        resumeData = parsed;
      } else {
        localStorage.removeItem('svoya:host');
      }
    } catch {
      localStorage.removeItem('svoya:host');
    }
  });

  async function resumeGame() {
    if (!resumeData) return;
    gameId = resumeData.gameId;
    packId = resumeData.packId;
    title = resumeData.title;
    try {
      packRounds = (await fetch(`/api/packs/${packId}`).then(r => r.json())).rounds;
    } catch {
      localStorage.removeItem('svoya:host');
      lastError.set('Не удалось загрузить пак игры');
      resumeData = null;
      return;
    }
    joinAs(gameId, 'host');
    step = 'live';
    resumeData = null;
  }

  function dismissResume() {
    localStorage.removeItem('svoya:host');
    resumeData = null;
  }

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
    localStorage.setItem('svoya:host', JSON.stringify({ gameId, packId, title }));
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

  // --- team management ---
  let newTeamNameInput = '';
  let newTeamNameError = '';
  // per-team rename inputs: teamId -> string
  let renameInputs: Record<string, string> = {};
  // per-team rename errors
  let renameErrors: Record<string, string> = {};

  let lastSeenNames: Record<string, string> = {};
  function syncRenameInputs(teams: any[]) {
    for (const t of teams) {
      if (renameInputs[t.id] === undefined || lastSeenNames[t.id] !== t.name) {
        renameInputs[t.id] = t.name;
        lastSeenNames[t.id] = t.name;
      }
    }
    renameInputs = renameInputs; // trigger Svelte reactivity
  }
  $: if (state?.teams) syncRenameInputs(state.teams);

  function teamHasPlayers(teamId: string): boolean {
    return (state?.players ?? []).some((p: any) => p.teamId === teamId);
  }

  function doCreateTeam() {
    if (!isValidTeamName(newTeamNameInput)) {
      newTeamNameError = 'Название: 1–40 символов, только буквы, цифры, пробел, . _ " -';
      return;
    }
    newTeamNameError = '';
    lastError.set('');
    hostAction('createTeam', { name: newTeamNameInput.trim() });
    newTeamNameInput = '';
  }

  function doRenameTeam(teamId: string) {
    const name = renameInputs[teamId] ?? '';
    if (!isValidTeamName(name)) {
      renameErrors[teamId] = 'Недопустимое название';
      return;
    }
    renameErrors[teamId] = '';
    lastError.set('');
    hostAction('renameTeam', { teamId, name: name.trim() });
  }

  function doDeleteTeam(teamId: string) {
    if (teamHasPlayers(teamId)) return;
    lastError.set('');
    hostAction('deleteTeam', { teamId });
  }

  function doMovePlayer(playerId: string, e: Event) {
    const newTeamId = (e.target as HTMLSelectElement).value;
    lastError.set('');
    hostAction('movePlayer', { playerId, teamId: newTeamId });
  }

  function endGame() {
    hostAction('endGame');
    localStorage.removeItem('svoya:host');
  }

  // dismiss lastError
  let errorMsg = '';
  $: errorMsg = $lastError;
</script>

{#if step === 'setup'}
  <main style="padding:2rem;display:grid;gap:1rem;max-width:30rem">
    <h1 class="neon">Создать игру</h1>

    {#if resumeData}
      <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem;border:1px solid var(--neon);display:flex;flex-direction:column;gap:.5rem">
        <div style="font-weight:700;color:var(--neon)">Продолжить игру: {resumeData.title}</div>
        <div style="display:flex;gap:.5rem">
          <button class="neon" on:click={resumeGame}>Продолжить</button>
          <button on:click={dismissResume}>Создать новую</button>
        </div>
      </div>
    {/if}

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
          <button class="neon" on:click={endGame}>Завершить игру</button>
        {/if}
      </div>

    {:else if state?.phase === 'LOBBY'}
      <!-- === ЛОББИ === -->
      <Scoreboard teams={state.teams} />

      <!-- Управление командами -->
      <div style="background:var(--panel);border-radius:.5rem;padding:.75rem 1rem">
        <div style="font-weight:700;margin-bottom:.75rem;color:var(--neon)">Управление командами</div>

        <!-- Добавить команду -->
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap">
          <input placeholder="Название новой команды" bind:value={newTeamNameInput}
            style="flex:1;min-width:10rem;background:#111;color:var(--neon);border:1px solid var(--neon);border-radius:.3rem;padding:.3rem .6rem"
            on:keydown={(e) => e.key === 'Enter' && doCreateTeam()} />
          <button class="neon" style="font-size:.85rem" on:click={doCreateTeam}>Добавить команду</button>
        </div>
        {#if newTeamNameError}
          <div style="color:#f87171;font-size:.8rem;margin-bottom:.5rem">{newTeamNameError}</div>
        {/if}

        <!-- Список команд -->
        {#each (state.teams ?? []) as team}
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;flex-wrap:wrap;padding:.4rem;background:#111;border-radius:.3rem">
            <input bind:value={renameInputs[team.id]}
              style="flex:1;min-width:8rem;background:#1a1a1a;color:var(--neon);border:1px solid #444;border-radius:.3rem;padding:.25rem .5rem;font-size:.9rem" />
            <button style="font-size:.8rem;padding:.2rem .5rem" on:click={() => doRenameTeam(team.id)}>Переименовать</button>
            <button style="font-size:.8rem;padding:.2rem .5rem;opacity:{teamHasPlayers(team.id) ? 0.4 : 1};cursor:{teamHasPlayers(team.id) ? 'not-allowed' : 'pointer'}"
              disabled={teamHasPlayers(team.id)}
              on:click={() => doDeleteTeam(team.id)}>Удалить</button>
            {#if renameErrors[team.id]}
              <span style="color:#f87171;font-size:.75rem">{renameErrors[team.id]}</span>
            {/if}
          </div>
        {/each}

        <!-- Ростер игроков с назначением команды -->
        {#if (state.players ?? []).length > 0}
          <div style="margin-top:.75rem">
            <div style="font-weight:700;margin-bottom:.5rem;color:var(--neon);font-size:.9rem">Игроки</div>
            {#each (state.players ?? []) as player}
              <div style="display:flex;align-items:center;gap:.5rem;font-size:.9rem;margin-bottom:.3rem;flex-wrap:wrap">
                <span style="font-size:.7rem;color:{player.connected ? '#4ade80' : '#6b7280'}">{player.connected ? '●' : '○'}</span>
                <span style="min-width:10rem">{player.lastName} {player.firstName}</span>
                <select value={player.teamId} on:change={(e) => doMovePlayer(player.id, e)}
                  style="background:#111;color:var(--neon);border:1px solid #444;border-radius:.3rem;padding:.2rem .4rem;font-size:.85rem">
                  {#each (state.teams ?? []) as t}
                    <option value={t.id}>{t.name}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Inline error from server -->
        {#if errorMsg}
          <div style="display:flex;align-items:center;gap:.5rem;margin-top:.5rem;padding:.4rem .75rem;background:#2d0a0a;border:1px solid #ef4444;border-radius:.3rem;color:#f87171;font-size:.85rem">
            <span style="flex:1">{errorMsg}</span>
            <button style="background:none;border:none;color:#f87171;cursor:pointer;padding:0;font-size:1rem;line-height:1" on:click={() => lastError.set('')}>×</button>
          </div>
        {/if}
      </div>

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
        <button on:click={endGame}>Конец игры</button>
      </div>

    {:else}
      <!-- состояние ещё не пришло от сервера -->
      <p style="color:var(--muted)">Подключение к игре…</p>
    {/if}
  </main>
{/if}
