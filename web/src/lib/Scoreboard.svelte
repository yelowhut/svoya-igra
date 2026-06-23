<script lang="ts">
  export let teams: { id: string; name: string; score: number }[] = [];
  $: sorted = [...teams].sort((a, b) => b.score - a.score);
</script>

<div class="board">
  {#each sorted as t, i}
    <div class="team {i === 0 ? 'leader' : ''}">
      <div class="name">{t.name}</div>
      <div class="score" class:neg={t.score < 0}>{t.score}</div>
    </div>
  {/each}
</div>

<style>
  .board { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
  .team {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: var(--r-card); padding: 14px 22px; text-align: center; min-width: 8rem;
  }
  .team.leader { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold), var(--shadow-card); }
  .name { font-family: var(--font-ui); font-size: 14px; color: var(--text-2); margin-bottom: 6px; }
  /* базовый счёт — золото; не-лидер белым; отрицательный красным (порядок важен для специфичности) */
  .score { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--gold); }
  .team:not(.leader) .score { color: var(--text); }
  .score.neg { color: var(--err); }
</style>
