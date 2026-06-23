<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Category } from '../bankApi.js';
  export let categories: Category[] = [];
  export let selectedId: string | null = null;
  const dispatch = createEventDispatcher<{
    select: string; create: string; rename: { id: string; name: string };
    reorder: string[]; delete: Category;
  }>();

  let newName = '';
  function add() { const n = newName.trim(); if (!n) return; dispatch('create', n); newName = ''; }
  function rename(c: Category) {
    const name = prompt('Новое имя категории', c.name)?.trim();
    if (name && name !== c.name) dispatch('rename', { id: c.id, name });
  }

  // ── drag&drop reorder ──
  let dragId: string | null = null;
  let overId: string | null = null;
  function onDrop(targetId: string) {
    overId = null;
    if (!dragId || dragId === targetId) { dragId = null; return; }
    const ids = categories.map(c => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { dragId = null; return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    dispatch('reorder', ids);
    dragId = null;
  }
</script>

<div class="pane">
  <div class="head"><span class="title">Категории</span></div>
  <form class="add" on:submit|preventDefault={add}>
    <input bind:value={newName} placeholder="Новая категория" />
    <button type="submit">+ Категория</button>
  </form>
  <ul>
    {#each categories as c (c.id)}
      <li
        class:active={c.id === selectedId}
        class:over={c.id === overId && dragId !== c.id}
        class:dragging={c.id === dragId}
        draggable="true"
        on:dragstart={() => (dragId = c.id)}
        on:dragend={() => { dragId = null; overId = null; }}
        on:dragover|preventDefault={() => (overId = c.id)}
        on:dragleave={() => { if (overId === c.id) overId = null; }}
        on:drop|preventDefault={() => onDrop(c.id)}
      >
        <span class="grip" title="Перетащите для сортировки" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        </span>
        <button class="name" on:click={() => dispatch('select', c.id)}>
          <span class="label">{c.name}</span>
        </button>
        <span class="count">{c.questionCount}</span>
        <button class="icon" title="Переименовать" on:click={() => rename(c)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>
        </button>
        <button class="icon del" title="Удалить" on:click={() => dispatch('delete', c)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; min-width: 0; overflow: hidden; }
  .head { margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { display: flex; gap: 8px; margin-bottom: 12px; }
  .add input { flex: 1; min-width: 0; height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
  .add button { flex-shrink: 0; white-space: nowrap; height: 36px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; align-items: center; gap: 4px; border-radius: var(--r-control); padding: 4px 6px; border: 1px solid transparent; }
  li.active { background: var(--cell-hover); border-color: var(--border-accent); }
  li.over { border-color: var(--accent); }
  li.dragging { opacity: .45; }
  .grip { display: flex; align-items: center; color: var(--text-4); cursor: grab; flex-shrink: 0; }
  .name { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text); font: inherit; cursor: pointer; padding: 6px 4px; text-align: left; }
  .label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { flex-shrink: 0; color: var(--text-3); font-size: 12px; min-width: 18px; text-align: center; }
  .icon { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; }
  .icon:hover { background: var(--cell); color: var(--text); }
  .icon.del:hover { color: var(--err); border-color: var(--err); }
</style>
