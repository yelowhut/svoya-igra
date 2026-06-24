<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, blockedUntil, lastError, me } from '../lib/store.js';
  import { connect, joinAs, buzz } from '../lib/socket.js';
  import { isValidTeamName } from '../lib/teamName.js';
  import Buzzer from '../lib/Buzzer.svelte';
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';

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
  // позиция в очереди (1-based), если забаззил и не отвечает сейчас
  $: myQueuePos = (() => {
    const i = (state?.buzzQueue ?? []).findIndex((b: any) => b.teamId === resolvedTeamId);
    return i >= 0 ? i + 1 : null;
  })();
  $: answeringName = state?.teams?.find((t: any) => t.id === state?.answeringTeamId)?.name ?? '';

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
    <!-- ── C. PLAY VIEW ───────────────────────────────────────────────── -->
    {#if state?.phase === 'BUZZER_OPEN' || (state?.phase === 'ANSWERING' && !myTurn && !state?.answeringTeamId)}
      <Buzzer blockedUntil={$blockedUntil} on:press={buzz} />
    {:else if myTurn}
      <div class="answer-circle">
        <div class="ac-title">ВЫ ОТВЕЧАЕТЕ!</div>
        <div class="ac-num" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</div>
        <div class="ac-cap">секунд на ответ — говорите вслух!</div>
      </div>
    {:else if state?.phase === 'ANSWERING' && state?.answeringTeamId}
      <div class="watch">
        <div class="w-lead">ОТВЕЧАЕТ</div>
        <div class="w-name">{answeringName}</div>
        <div class="w-time" class:low={$answerLow}>осталось {$answerSecondsLeft ?? '—'} с</div>
        {#if myQueuePos}<div class="w-queue">Вы в очереди · #{myQueuePos}</div>{/if}
      </div>
    {:else if myPick}
      <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
    {:else if state?.currentPrompt}
      <p style="font-size:1.5rem">{state.currentPrompt}</p>
    {:else}
      <p>Ждём ведущего…</p>
    {/if}
  {/if}

</main>

<style>
  .answer-circle { display: grid; place-items: center; gap: 8px; width: 280px; height: 280px; border-radius: 50%;
    background: radial-gradient(circle at 50% 45%, #43e9b0 0%, #1fd18e 60%, #149f6c 100%);
    box-shadow: 0 0 60px rgba(31,209,142,.5); color: #042; }
  .ac-title { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 34px; line-height: 1; }
  .ac-num { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 64px; line-height: 1; color: #f5c518; }
  .ac-num.low { color: #ff4d4d; }
  .ac-cap { font-size: 13px; max-width: 220px; opacity: .8; }
  .watch { display: grid; place-items: center; gap: 8px; text-align: center; }
  .w-lead { letter-spacing: .1em; text-transform: uppercase; font-size: 13px; opacity: .5; }
  .w-name { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 44px; text-transform: uppercase; }
  .w-time { font-size: 18px; color: #f5c518; }
  .w-time.low { color: #ff4d4d; }
  .w-queue { margin-top: 8px; padding: 10px 16px; border-radius: 12px; background: rgba(124,92,255,.12);
    border: 1px solid rgba(124,92,255,.35); color: #cdbcff; font-weight: 600; }
</style>
