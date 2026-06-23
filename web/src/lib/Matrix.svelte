<script lang="ts">
  export let round: any;
  export let usedQuestionIds: string[] = [];
  export let selectedId: string | null = null;
  export let clickable = false;
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  const isUsed = (id: string) => usedQuestionIds.includes(id);
</script>

<div class="matrix">
  {#each round?.categories ?? [] as cat}
    <div class="row" style="grid-template-columns:10rem repeat({cat.questions.length}, 1fr)">
      <div class="cat">{cat.name}</div>
      {#each cat.questions as q}
        <button
          class="cell {isUsed(q.id) ? 'used' : ''} {selectedId === q.id ? 'selected' : ''}"
          disabled={!clickable || isUsed(q.id)}
          on:click={() => dispatch('select', { questionId: q.id, value: q.value, special: q.special })}>
          {#if isUsed(q.id)}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor"
                stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            {q.value}
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .matrix { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: center; }
  .cat {
    font-family: var(--font-display); font-weight: 600; font-size: 15px;
    text-transform: uppercase; letter-spacing: .03em; color: var(--text);
    background: var(--grad-rowlabel); border: 1px solid var(--border);
    border-radius: var(--r-control); padding: 12px 14px;
  }
  .cell {
    padding: 16px; background: var(--cell); border: 1px solid var(--border);
    border-radius: var(--r-control); color: var(--gold);
    font-family: var(--font-display); font-size: 26px; font-weight: 700;
    cursor: pointer; transition: background .12s;
  }
  .cell:not(:disabled):hover { background: var(--cell-hover); }
  .cell.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--border-accent); }
  .cell.used { background: #100d1c; color: var(--text-4); cursor: default; }
</style>
