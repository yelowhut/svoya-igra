<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchActiveGame, type ActiveGame } from './api.js';

  let loading = true;
  let game: ActiveGame | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    game = await fetchActiveGame();
    loading = false;
  }

  onMount(() => {
    refresh();
    timer = setInterval(refresh, 4000); // поллинг ~4с
  });
  onDestroy(() => { if (timer) clearInterval(timer); });

  $: ended = game?.phase === 'GAME_END';
  $: statusLabel = !game ? '' :
    game.phase === 'LOBBY' ? 'Лобби · идёт сбор команд' :
    ended ? 'Игра завершена' :
    `Идёт сейчас · раунд ${game.currentRound} из ${game.totalRounds}`;

  function enter() { if (game) location.href = `/play?game=${game.gameId}`; }
  function openBoard() { if (game) location.href = `/board?game=${game.gameId}`; }
</script>

<main class="wrap">
  <header class="hero">
    <div class="kicker">Добро пожаловать</div>
    <h1 class="game-heading">Большая домашняя викторина</h1>
    <p class="lede">Соберитесь с друзьями, выберите команду и жмите buzzer быстрее всех. Ведущий уже готовит сетку.</p>
  </header>

  <section class="games">
    <div class="games-label">Активная игра</div>

    {#if loading}
      <div class="card skeleton">Загружаем…</div>
    {:else if !game}
      <div class="card empty">Пока нет активной игры — ведущий вот-вот её запустит.</div>
    {:else}
      <div class="card" class:ended>
        <div class="status"><span class="dot" class:live={!ended}></span>{statusLabel}</div>
        <div class="game-title">{game.title}</div>
        <div class="metrics">
          <span>до {game.teamCount} команд</span>
          <span>игроков сейчас: {game.playerCount}</span>
          <span>раундов: {game.totalRounds}</span>
        </div>
        {#if !ended}
          <div class="actions">
            <button class="primary" on:click={enter}>Войти в игру</button>
            <button class="ghost" on:click={openBoard}>Открыть табло</button>
          </div>
        {/if}
      </div>
    {/if}
  </section>
</main>

<style>
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  .hero { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 28px; margin-bottom: 22px; }
  .kicker { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  .game-heading { font-family: var(--font-display); text-transform: uppercase; font-size: 40px; line-height: 1.02; margin: 8px 0 12px; }
  .lede { color: var(--text-2); margin: 0; }
  .games-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; margin-bottom: 10px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 22px; }
  .card.ended { opacity: .62; }
  .card.empty { border-style: dashed; color: var(--text-2); text-align: center; }
  .card.skeleton { color: var(--text-3); }
  .status { display: flex; align-items: center; gap: 8px; color: var(--ok); font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-3); }
  .dot.live { background: var(--ok); box-shadow: 0 0 10px var(--ok); }
  .game-title { font-family: var(--font-display); text-transform: uppercase; font-size: 34px; margin: 8px 0 12px; }
  .metrics { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-2); font-size: 14px; margin-bottom: 18px; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; }
  @media (max-width: 480px) { .game-heading { font-size: 32px; } .actions { flex-direction: column; } }
</style>
