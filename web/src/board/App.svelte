<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore } from '../lib/store.js';
  import { joinAs } from '../lib/socket.js';
  import Scoreboard from '../lib/Scoreboard.svelte';
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';
  const gameId = new URLSearchParams(location.search).get('game') ?? '';
  let state: any = null; $: state = $gameStore;
  $: answeringName = state?.teams?.find((t: any) => t.id === state?.answeringTeamId)?.name ?? '';
  const queueNames = (s: any): string =>
    (s.buzzQueue ?? [])
      .map((b: { teamId: string }) => s.teams.find((t: { id: string }) => t.id === b.teamId)?.name)
      .join(' → ');
  onMount(async () => {
    if (!gameId) return;
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json());
    if (r.exists) joinAs(gameId, 'board');
  });
</script>

<main style="min-height:100vh;padding:2rem;display:grid;gap:2rem">
  {#if !state}
    <div style="display:grid;place-items:center;height:80vh"><h1 class="neon">Своя игра</h1><p>Игра ещё не началась</p></div>
  {:else if state.phase === 'GAME_END'}
    <h1 class="neon" style="text-align:center;font-size:3rem">🏆 Финал! 🎉</h1>
    <Scoreboard teams={state.teams} />
  {:else if state.phase === 'ROUND_END'}
    <h1 class="neon" style="text-align:center">Итоги раунда</h1>
    <Scoreboard teams={state.teams} />
  {:else}
    {#if state.currentPrompt}
      <div style="display:grid;place-items:center;min-height:50vh;text-align:center">
        <p style="font-size:2.5rem">{state.currentPrompt}</p>
        {#if state.currentType === 'image'}<img src={`/media/${state.packId}/${state.currentMedia}`} style="max-width:60vw;max-height:40vh" alt="" />{/if}
        {#if state.currentType === 'audio'}<audio controls src={`/media/${state.packId}/${state.currentMedia}`}></audio>{/if}
      </div>
    {/if}
    {#if state.phase === 'ANSWERING' && state.answeringTeamId}
      <div class="board-answer">
        <div class="ba-lead">ОТВЕЧАЕТ</div>
        <div class="ba-name">{answeringName}</div>
        <div class="ba-time" class:low={$answerLow}>осталось <span>{$answerSecondsLeft ?? '—'}</span></div>
      </div>
    {/if}
    {#if state.buzzQueue?.length}
      <div style="text-align:center" class="neon">Очередь: {queueNames(state)}</div>
    {/if}
    <Scoreboard teams={state.teams} />
  {/if}
</main>

<style>
  .board-answer { display: grid; place-items: center; gap: 10px; text-align: center; }
  .ba-lead { letter-spacing: .1em; text-transform: uppercase; opacity: .5; }
  .ba-name { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 3rem; text-transform: uppercase; color: #43e9b0; }
  .ba-time { font-size: 1.4rem; color: #f5c518; }
  .ba-time span { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 3.5rem; }
  .ba-time.low, .ba-time.low span { color: #ff4d4d; }
</style>
