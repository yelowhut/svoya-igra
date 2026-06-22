<script lang="ts">
  export let round: any; export let usedQuestionIds: string[] = []; export let clickable = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>
<div style="display:grid;gap:.5rem">
  {#each round?.categories ?? [] as cat}
    <div style="display:grid;grid-template-columns:10rem repeat({cat.questions.length},1fr);gap:.5rem;align-items:center">
      <div class="neon" style="font-weight:700">{cat.name}</div>
      {#each cat.questions as q}
        <button disabled={!clickable || usedQuestionIds.includes(q.id)}
          on:click={() => dispatch('select', { questionId: q.id, value: q.value, special: q.special })}
          style="padding:1rem;background:var(--panel);border:1px solid var(--neon);border-radius:.5rem;color:var(--gold);font-size:1.4rem;font-weight:700;opacity:{usedQuestionIds.includes(q.id)?0.25:1}">
          {usedQuestionIds.includes(q.id) ? '' : q.value}
        </button>
      {/each}
    </div>
  {/each}
</div>
