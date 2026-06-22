<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, blockedUntil } from '../lib/store.js';
  import { joinAs, buzz } from '../lib/socket.js';
  import Buzzer from '../lib/Buzzer.svelte';

  const gameId = new URLSearchParams(location.search).get('game') ?? '';
  let exists = false, joined = false, firstName = '', lastName = '', teamId = '';
  let state: any = null; $: state = $gameStore;

  onMount(async () => {
    if (!gameId) return;
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json());
    exists = r.exists;
  });
  function doJoin() {
    if (!firstName.trim() || !lastName.trim() || !teamId) return;
    joinAs(gameId, 'player', firstName.trim(), lastName.trim(), teamId);
    joined = true;
  }
  $: myTurn = state && state.answeringTeamId && state.answeringTeamId === teamId;
  $: myPick = state && state.phase === 'PICKING' && state.pickingTeamId === teamId;
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:1rem">
  {#if !exists}
    <div><h1 class="neon">Своя игра</h1><p>Игра ещё не началась</p></div>
  {:else if !joined}
    <div style="display:grid;gap:.75rem;max-width:20rem">
      <h1 class="neon">Вход в игру</h1>
      <input placeholder="Фамилия" bind:value={lastName} />
      <input placeholder="Имя" bind:value={firstName} />
      <select bind:value={teamId}>
        <option value="">— команда —</option>
        {#each state?.teams ?? [] as t}<option value={t.id}>{t.name}</option>{/each}
      </select>
      <button on:click={doJoin} class="neon">Войти</button>
    </div>
  {:else}
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
