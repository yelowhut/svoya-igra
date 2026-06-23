<script context="module" lang="ts">
  import { writable } from 'svelte/store';
  export type DragPayload =
    | { kind: 'category'; id: string }
    | { kind: 'question'; id: string; categoryId: string };
  export const drag = writable<DragPayload | null>(null);
</script>

<script lang="ts">
  export let bank: { categories: { id: string; name: string }[]; questions: { id: string; categoryId: string; type: string; prompt: string }[] };
  function qOf(catId: string) { return bank.questions.filter(q => q.categoryId === catId); }
</script>

<aside class="src">
  <h2>База · источник</h2>
  {#each bank.categories as c (c.id)}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="cat" draggable="true"
      on:dragstart={() => drag.set({ kind: 'category', id: c.id })}
      on:dragend={() => drag.set(null)}>
      <span class="grip" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/>
          <circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </span>
      {c.name}
    </div>
    <ul class="qs">
      {#each qOf(c.id) as q (q.id)}
        <li class="q" draggable="true"
          on:dragstart={() => drag.set({ kind: 'question', id: q.id, categoryId: c.id })}
          on:dragend={() => drag.set(null)}>
          <span class="type">{q.type === 'image' ? '🖼' : q.type === 'audio' ? '🔊' : 'A'}</span>
          {q.prompt.slice(0, 32) || '(без текста)'}
        </li>
      {/each}
    </ul>
  {/each}
</aside>

<style>
  .src { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 12px; overflow-y: auto; }
  h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 14px; margin: 0 0 10px; color: var(--text-2); }
  .cat { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: var(--grad-rowlabel);
    border: 1px solid var(--border); border-radius: var(--r-control); cursor: grab; font-family: var(--font-display); }
  .grip { color: var(--text-3); }
  .qs { list-style: none; margin: 4px 0 12px; padding: 0 0 0 12px; display: grid; gap: 4px; }
  .q { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--cell); border: 1px solid var(--border);
    border-radius: var(--r-control); cursor: grab; font-size: 13px; }
  .type { color: var(--accent); font-weight: 700; }
</style>
