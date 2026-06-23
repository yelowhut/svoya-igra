<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import { isValidTeamName } from '../../lib/teamName.js';
  import { workingGameId, answerTimerSec } from '../store.js';
  import { listPacks, listGames, gameExists, createGame, activateGame, deactivateGame, type PackSummary, type GameSummary } from '../gameApi.js';
  import { navigate } from '../router.js';

  let state: any = null; $: state = $gameStore;
  let packs: PackSummary[] = [];
  let games: GameSummary[] = [];
  let packId = '', title = '', teamCount = 3;
  let gameId: string | null = null; $: gameId = $workingGameId;
  let activated = false;
  let errorMsg = ''; $: errorMsg = $lastError;

  // team management
  let newTeamNameInput = '', newTeamNameError = '';
  let renameInputs: Record<string, string> = {};
  let lastSeenNames: Record<string, string> = {};

  onMount(async () => {
    packs = await listPacks().catch(() => []);
    games = await listGames().catch(() => []);
    // восстановленная из localStorage рабочая игра: подключиться, если ещё существует
    if (gameId) {
      const ok = await gameExists(gameId).then(r => r.exists).catch(() => false);
      if (ok) joinAs(gameId, 'host');
      else workingGameId.set(null);
      // флаг activated отражает текущую активность: сверяем с публичным указателем
      try {
        const ag = await fetch('/api/active-game').then(r => r.json());
        activated = ag?.gameId === gameId;
      } catch { /* ignore */ }
    }
  });

  function syncRenameInputs(teams: any[]) {
    for (const t of teams) {
      if (renameInputs[t.id] === undefined || lastSeenNames[t.id] !== t.name) {
        renameInputs[t.id] = t.name; lastSeenNames[t.id] = t.name;
      }
    }
    renameInputs = renameInputs;
  }
  $: if (state?.teams) syncRenameInputs(state.teams);

  function teamHasPlayers(teamId: string): boolean {
    return (state?.players ?? []).some((p: any) => p.teamId === teamId);
  }

  async function doCreateGame() {
    if (!packId || !title) return;
    try {
      const r = await createGame(packId, title, teamCount);
      workingGameId.set(r.gameId);
      joinAs(r.gameId, 'host');
      for (let i = 0; i < teamCount; i++) hostAction('createTeam', { name: `Команда ${i + 1}` });
    } catch (e) {
      lastError.set((e as Error).message || 'Не удалось создать игру');
    }
  }

  async function selectExisting(g: GameSummary) {
    if (!(await gameExists(g.gameId)).exists) return;
    workingGameId.set(g.gameId);
    title = g.title;
    joinAs(g.gameId, 'host');
  }

  function doCreateTeam() {
    if (!isValidTeamName(newTeamNameInput)) { newTeamNameError = 'Название: 1–40 символов, буквы/цифры/пробел/. _ " -'; return; }
    newTeamNameError = ''; lastError.set('');
    hostAction('createTeam', { name: newTeamNameInput.trim() });
    newTeamNameInput = '';
  }
  function doRenameTeam(teamId: string) {
    const name = renameInputs[teamId] ?? '';
    if (!isValidTeamName(name)) return;
    lastError.set(''); hostAction('renameTeam', { teamId, name: name.trim() });
  }
  function doDeleteTeam(teamId: string) {
    if (teamHasPlayers(teamId)) return;
    lastError.set(''); hostAction('deleteTeam', { teamId });
  }
  function doMovePlayer(playerId: string, e: Event) {
    lastError.set('');
    hostAction('movePlayer', { playerId, teamId: (e.target as HTMLSelectElement).value });
  }

  async function activate() { if (gameId) { await activateGame(gameId); activated = true; } }
  async function deactivate() { if (gameId) { await deactivateGame(gameId); activated = false; } }
  function startGame() { hostAction('startRound', { roundIndex: 0 }); navigate('pult'); }

  const presets = [30, 45, 60];

  // Rounds count: derive from pack list once we know the state's packId
  $: roundCount = packs.find(p => p.id === state?.packId)?.rounds ?? 0;

  // Compute meta line: "N команд · K игроков · M раундов"
  $: teamCountMeta = state?.teams?.length ?? 0;
  $: playerCountMeta = (state?.players ?? []).length;

</script>

<section class="lobby">
  {#if !gameId || !state}
    <!-- ШАГ ВЫБОРА/СОЗДАНИЯ ИГРЫ -->
    <h1 class="screen-title">Лобби и команды</h1>

    {#if games.length}
      <div class="panel">
        <div class="panel-label">Продолжить игру</div>
        {#each games as g}
          <button class="ghost" on:click={() => selectExisting(g)}>{g.title} · {g.phase}</button>
        {/each}
      </div>
    {/if}

    <div class="panel">
      <div class="panel-label">Новая игра</div>
      <label>Игра (опубликованный пак):
        <select bind:value={packId}>
          <option value="">— выбрать —</option>
          {#each packs as p}<option value={p.id}>{p.title} · {p.rounds} р.</option>{/each}
        </select>
      </label>
      <input placeholder="Название игры" bind:value={title} />
      <label>Команд: <input type="number" min="2" max="8" bind:value={teamCount} /></label>

      <div class="timer">
        <span class="timer-label">Время на ответ</span>
        <button class="step" on:click={() => answerTimerSec.update(v => Math.max(10, v - 5))}>−</button>
        <strong class="timer-val">{$answerTimerSec}</strong><span>с</span>
        <button class="step" on:click={() => answerTimerSec.update(v => v + 5)}>+</button>
        {#each presets as p}
          <button class="preset" class:on={$answerTimerSec === p} on:click={() => answerTimerSec.set(p)}>{p}</button>
        {/each}
      </div>
      <p class="muted">Обратный отсчёт для отвечающей команды. (Появится в следующем обновлении.)</p>

      <button class="primary" disabled={!packId || !title} on:click={doCreateGame}>Создать игру</button>
    </div>
  {:else}
    <!-- ЛОББИ ВЫБРАННОЙ ИГРЫ -->
    <div class="head">
      <div>
        <h1 class="screen-title">{title || state.title}</h1>
        <div class="meta">
          {teamCountMeta} команд · {playerCountMeta} игроков{#if roundCount} · {roundCount} раундов{/if}
        </div>
      </div>
      <div class="head-actions">
        {#if activated}
          <span class="active-badge">Активна — видна игрокам</span>
          <button class="ghost" on:click={deactivate}>Скрыть</button>
        {:else}
          <button class="primary" on:click={activate}>Активировать</button>
        {/if}
        <button class="primary" on:click={startGame}>Начать раунд 1</button>
      </div>
    </div>

    <!-- Блок «Время на ответ» -->
    <div class="panel">
      <div class="timer">
        <span class="timer-label">Время на ответ</span>
        <button class="step" on:click={() => answerTimerSec.update(v => Math.max(10, v - 5))}>−</button>
        <strong class="timer-val">{$answerTimerSec}</strong><span>с</span>
        <button class="step" on:click={() => answerTimerSec.update(v => v + 5)}>+</button>
        {#each presets as p}
          <button class="preset" class:on={$answerTimerSec === p} on:click={() => answerTimerSec.set(p)}>{p}</button>
        {/each}
      </div>
      <p class="muted">Обратный отсчёт для отвечающей команды. Не успели — ответ не засчитан, ход переходит следующей в очереди.</p>
    </div>

    <div class="panel">
      <div class="panel-label">Команды</div>
      <div class="add-team">
        <input placeholder="Название новой команды" bind:value={newTeamNameInput}
          on:keydown={(e) => e.key === 'Enter' && doCreateTeam()} />
        <button class="ghost" on:click={doCreateTeam}>+ Команда</button>
      </div>
      {#if newTeamNameError}<div class="err">{newTeamNameError}</div>{/if}
      {#each (state.teams ?? []) as team}
        <div class="team-row">
          <input bind:value={renameInputs[team.id]} on:keydown={(e) => e.key === 'Enter' && doRenameTeam(team.id)} />
          <button class="icon" on:click={() => doRenameTeam(team.id)} title="Переименовать">✎</button>
          <button class="icon" disabled={teamHasPlayers(team.id)} on:click={() => doDeleteTeam(team.id)} title="Удалить">🗑</button>
        </div>
      {/each}
    </div>

    {#if (state.players ?? []).length > 0}
      <div class="panel">
        <div class="panel-label">Ростер — перенос игрока между командами</div>
        {#each (state.players ?? []) as player}
          <div class="player-row">
            <span class="dot" class:online={player.connected}></span>
            <span class="pname" class:muted={!player.connected}>{player.lastName} {player.firstName}</span>
            {#if !player.connected}<span class="offline-tag">офлайн</span>{/if}
            <select value={player.teamId} on:change={(e) => doMovePlayer(player.id, e)}>
              {#each (state.teams ?? []) as t}<option value={t.id}>{t.name}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
    {/if}

    {#if errorMsg}
      <div class="err-bar"><span>{errorMsg}</span><button on:click={() => lastError.set('')}>×</button></div>
    {/if}
  {/if}
</section>

<style>
  /* СТРУКТУРА. Точные цвета/радиусы/тени — из theme.css; раскладку и акценты
     выровнять по прототипу §5.5. */
  .lobby { display: flex; flex-direction: column; gap: 18px; max-width: 920px; }
  .screen-title { font-family: var(--font-display); text-transform: uppercase; margin: 0; }
  .meta { color: var(--text-2); font-size: 14px; margin-top: 6px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .head-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .active-badge { color: var(--ok); font-size: 13px; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .panel-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
select, input { height: 40px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 12px; font: inherit; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--text-2); }
  label select, label input { margin-top: 2px; }
  .timer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .timer-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; margin-right: 6px; }
  .timer-val { color: var(--gold); font-family: var(--font-display); font-size: 28px; }
  .step, .preset {
    border: 1px solid var(--border); background: var(--surface); color: var(--text);
    border-radius: var(--r-control); padding: 6px 12px; cursor: pointer; font: inherit;
  }
  .preset.on { border-color: var(--border-accent); background: var(--cell-hover); }
  .muted { color: var(--text-3); font-size: 13px; margin: 0; }
  .add-team { display: flex; gap: 8px; }
  .team-row, .player-row { display: flex; align-items: center; gap: 8px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .icon:disabled { opacity: .4; cursor: not-allowed; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-3); }
  .dot.online { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .pname { min-width: 160px; }
  .offline-tag { font-size: 10px; text-transform: uppercase; color: var(--text-3); letter-spacing: .06em; }
  .err { color: var(--err); font-size: 13px; }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; font-size: 16px; }
</style>
