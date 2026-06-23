<script context="module" lang="ts">
  import { writable } from 'svelte/store';
  export type DragPayload = { kind: 'category'; id: string };
  export const drag = writable<DragPayload | null>(null);
</script>

<script lang="ts">
  export let bank: { categories: { id: string; name: string }[]; questions: { id: string; categoryId: string }[] };
  function countOf(catId: string) { return bank.questions.filter(q => q.categoryId === catId).length; }
</script>

<aside class="src">
  <h2>Категории</h2>
  <p class="hint">Перетащите категорию в строку сетки. Вопросы выбираются кликом по ячейке.</p>
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
      <span class="name">{c.name}</span>
      <span class="count">{countOf(c.id)}</span>
    </div>
  {/each}
  {#if bank.categories.length === 0}
    <p class="hint">Категорий пока нет — создайте их в «Базе вопросов».</p>
  {/if}
</aside>

<style>
  .src { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 14px; margin: 0 0 4px; color: var(--text-2); }
  .hint { color: var(--text-3); font-size: 12px; margin: 0 0 6px; }
  .cat { display: flex; align-items: center; gap: 8px; padding: 9px 10px; background: var(--grad-rowlabel);
    border: 1px solid var(--border); border-radius: var(--r-control); cursor: grab; font-family: var(--font-display); }
  .cat:hover { border-color: var(--border-accent); }
  .grip { color: var(--text-3); flex-shrink: 0; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { flex-shrink: 0; color: var(--text-3); font-size: 12px; }
</style>
