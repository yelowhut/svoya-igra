<script lang="ts">
  export let teams: { id: string; name: string; score: number }[] = [];
  $: sorted = [...teams].sort((a, b) => b.score - a.score);
</script>
<div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center">
  {#each sorted as t, i}
    <div style="background:var(--panel);border:2px solid {i===0?'var(--gold)':'var(--neon)'};border-radius:.75rem;padding:1rem 1.5rem;text-align:center;min-width:8rem">
      <div style="font-size:1.1rem">{t.name}</div>
      <div class="neon" style="font-size:2rem;font-weight:800;color:{i===0?'var(--gold)':'var(--neon)'}">{t.score}</div>
    </div>
  {/each}
</div>
