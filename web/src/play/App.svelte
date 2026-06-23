<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, blockedUntil, lastError, me } from '../lib/store.js';
  import { connect, joinAs, buzz } from '../lib/socket.js';
  import { isValidTeamName } from '../lib/teamName.js';
  import Buzzer from '../lib/Buzzer.svelte';

  // ── URL param ────────────────────────────────────────────────────────────
  const gameId = new URLSearchParams(location.search).get('game') ?? '';

  // ── Single-game state ────────────────────────────────────────────────────
  let exists = false;
  let joined = false;

  // form fields
  let firstName = '';
  let lastName  = '';
  let teamId    = '';        // pick existing
  let newTeamName = '';      // create new

  // pending join flag: we set this on submit so we can react to $me only once
  let pendingJoin = false;

  let formHint = '';

  let state: any = null;
  $: state = $gameStore;

  // ── Available teams (fetched via HTTP before join) ───────────────────────
  let availableTeams: { id: string; name: string }[] = [];

  // ── Derived play-view flags ──────────────────────────────────────────────
  $: resolvedTeamId = $me?.teamId ?? teamId;
  $: myTurn = state && state.answeringTeamId && state.answeringTeamId === resolvedTeamId;
  $: myPick = state && state.phase === 'PICKING' && state.pickingTeamId === resolvedTeamId;

  // ── React to youAre for join confirmation + localStorage ────────────────
  $: if ($me && pendingJoin) {
    pendingJoin = false;
    localStorage.setItem('svoya:player', JSON.stringify({
      gameId,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      teamId:    $me.teamId,
    }));
    joined = true;
  }

  // ── Break deadlock: if error during join, clear pendingJoin to show form ──
  $: if ($lastError && pendingJoin && !joined) pendingJoin = false;

  // ── Mount ────────────────────────────────────────────────────────────────
  onMount(async () => {
    lastError.set('');

    if (!gameId) {
      location.href = '/';   // публичный список игр теперь на лендинге
      return;
    }

    // Single-game flow
    connect();
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json()).catch(() => ({ exists: false }));
    exists = r.exists;
    if (!exists) return;

    // Fetch teams via HTTP so they're visible before joining
    availableTeams = await fetch(`/api/games/${gameId}/teams`).then(r => r.json()).catch(() => []);

    // Player resume
    const raw = localStorage.getItem('svoya:player');
    if (raw) {
      try {
        const stored = JSON.parse(raw) as { gameId: string; firstName: string; lastName: string; teamId: string };
        if (stored.gameId === gameId) {
          // Restore field values so they're available for localStorage update on youAre
          firstName = stored.firstName;
          lastName  = stored.lastName;
          teamId    = stored.teamId;
          pendingJoin = true;
          joinAs(gameId, 'player', stored.firstName, stored.lastName, stored.teamId);
          return;
        }
      } catch {
        // ignore malformed stored data
      }
    }
  });

  // ── Submit join form ──────────────────────────────────────────────────────
  function doJoin() {
    formHint = '';
    lastError.set('');
    const fn = firstName.trim();
    const ln = lastName.trim();

    if (!fn || !ln) {
      formHint = 'Введите фамилию и имя.';
      return;
    }

    const useNewTeam = newTeamName.trim().length > 0;

    if (useNewTeam) {
      if (!isValidTeamName(newTeamName)) {
        formHint = 'Недопустимое название команды (1–40 символов, буквы, цифры, пробел, . _ " -)';
        return;
      }
      pendingJoin = true;
      joinAs(gameId, 'player', fn, ln, '', newTeamName.trim());
    } else if (teamId) {
      pendingJoin = true;
      joinAs(gameId, 'player', fn, ln, teamId);
    } else {
      formHint = 'Выберите или создайте команду.';
    }
  }
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:1rem">

  {#if !exists}
    <!-- ── B-notfound ──────────────────────────────────────────────────── -->
    <div>
      <h1 class="neon">Своя игра</h1>
      <p>Игра не найдена</p>
    </div>

  {:else if pendingJoin && !joined}
    <!-- ── B-pending: waiting for server confirmation ──────────────── -->
    <p>Подключение…</p>
    {#if $lastError}<p style="color:#ff6b6b">{$lastError}</p>{/if}

  {:else if !joined}
    <!-- ── B. JOIN FORM ───────────────────────────────────────────────── -->
    <div style="display:grid;gap:.75rem;max-width:22rem;width:100%">
      <h1 class="neon">Вход в игру</h1>

      <input placeholder="Фамилия" bind:value={lastName} />
      <input placeholder="Имя"     bind:value={firstName} />

      <select bind:value={teamId} style={newTeamName.trim() ? 'opacity:.4' : ''}>
        <option value="">— выбрать команду —</option>
        {#each availableTeams as t}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>

      <div style="display:flex;align-items:center;gap:.4rem">
        <span style="font-size:.85rem;opacity:.7">или создать:</span>
        <input
          placeholder="Название команды"
          bind:value={newTeamName}
          style="flex:1"
          on:input={() => { if (newTeamName.trim()) teamId = ''; }}
        />
      </div>

      {#if formHint}
        <p style="color:#f87;margin:0;font-size:.85rem">{formHint}</p>
      {/if}
      {#if $lastError}
        <p style="color:#f44;margin:0;font-size:.85rem">{$lastError}</p>
      {/if}

      <button on:click={doJoin} class="neon">Войти</button>
    </div>

  {:else}
    <!-- ── C. PLAY VIEW (unchanged logic) ────────────────────────────── -->
    {#if state?.phase === 'BUZZER_OPEN' || (state?.phase === 'ANSWERING' && !myTurn)}
      <Buzzer blockedUntil={$blockedUntil} on:press={buzz} />
    {:else if myTurn}
      <h1 class="neon">ВЫ ОТВЕЧАЕТЕ!</h1>
    {:else if myPick}
      <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
    {:else if state?.currentPrompt}
      <p style="font-size:1.5rem">{state.currentPrompt}</p>
    {:else}
      <p>Ждём ведущего…</p>
    {/if}
  {/if}

</main>
