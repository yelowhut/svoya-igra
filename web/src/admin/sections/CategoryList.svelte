<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Category } from '../bankApi.js';
  import Modal from './Modal.svelte';
  export let categories: Category[] = [];
  export let selectedId: string | null = null;
  const dispatch = createEventDispatcher<{
    select: string; create: string; rename: { id: string; name: string };
    reorder: string[]; delete: Category;
  }>();

  let newName = '';
  function add() { const n = newName.trim(); if (!n) return; dispatch('create', n); newName = ''; }

  // ── переименование (модалка) ──
  let renaming: Category | null = null;
  let renameValue = '';
  function openRename(c: Category) { renaming = c; renameValue = c.name; }
  function submitRename() {
    const n = renameValue.trim();
    if (renaming && n && n !== renaming.name) dispatch('rename', { id: renaming.id, name: n });
    renaming = null;
  }
  function autofocus(node: HTMLInputElement) { node.focus(); node.select(); }

  // ── drag&drop с линией-индикатором вставки ──
  let dragId: string | null = null;
  let dropIndex: number | null = null;
  function onDragOver(e: DragEvent, i: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = (e.clientY - r.top) > r.height / 2 ? i + 1 : i;
  }
  function onDrop() {
    if (dragId === null || dropIndex === null) return reset();
    const ids = categories.map(c => c.id);
    const from = ids.indexOf(dragId);
    if (from < 0) return reset();
    let to = dropIndex;
    ids.splice(from, 1);
    if (from < to) to--;
    ids.splice(to, 0, dragId);
    dispatch('reorder', ids);
    reset();
  }
  function reset() { dragId = null; dropIndex = null; }
</script>

<div class="pane">
  <div class="head"><span class="title">Категории</span></div>
  <form class="add" on:submit|preventDefault={add}>
    <input bind:value={newName} placeholder="Новая категория" />
    <button type="submit">+ Категория</button>
  </form>
  <ul>
    {#each categories as c, i (c.id)}
      <li
        class:active={c.id === selectedId}
        class:dragging={c.id === dragId}
        class:drop-before={dropIndex === i}
        class:drop-after={dropIndex === categories.length && i === categories.length - 1}
        draggable="true"
        on:dragstart={() => (dragId = c.id)}
        on:dragend={reset}
        on:dragover|preventDefault={(e) => onDragOver(e, i)}
        on:drop|preventDefault={onDrop}
      >
        <span class="grip" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        </span>
        <button class="name" on:click={() => dispatch('select', c.id)}>
          <span class="label">{c.name}</span>
        </button>
        <span class="count">{c.questionCount}</span>
        <button class="icon" title="Переименовать" on:click={() => openRename(c)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>
        </button>
        <button class="icon del" title="Удалить" on:click={() => dispatch('delete', c)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>
        </button>
      </li>
    {/each}
  </ul>
</div>

{#if renaming}
  <Modal title="Переименовать категорию" on:close={() => (renaming = null)}>
    <form class="rename" on:submit|preventDefault={submitRename}>
      <input bind:value={renameValue} use:autofocus />
      <div class="modal-actions">
        <button type="button" class="ghost" on:click={() => (renaming = null)}>Отмена</button>
        <button type="submit" class="primary">Сохранить</button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; min-width: 0; overflow: hidden; }
  .head { margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { display: flex; gap: 8px; margin-bottom: 12px; }
  .add input { flex: 1; min-width: 0; height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
  .add button { flex-shrink: 0; white-space: nowrap; height: 36px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { position: relative; display: flex; align-items: center; gap: 4px; border-radius: var(--r-control); padding: 4px 6px; border: 1px solid transparent; }
  li.active { background: var(--cell-hover); border-color: var(--border-accent); }
  li.dragging { opacity: .4; }
  li.drop-before::before, li.drop-after::after { content: ''; position: absolute; left: 4px; right: 4px; height: 2px; background: var(--accent); border-radius: 2px; box-shadow: 0 0 6px var(--accent); }
  li.drop-before::before { top: -3px; }
  li.drop-after::after { bottom: -3px; }
  .grip { display: flex; align-items: center; color: var(--text-4); cursor: grab; flex-shrink: 0; }
  .name { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text); font: inherit; cursor: pointer; padding: 6px 4px; text-align: left; }
  .label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { flex-shrink: 0; color: var(--text-3); font-size: 12px; min-width: 18px; text-align: center; }
  .icon { flex-shrink: 0; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; }
  .icon:hover { background: var(--cell); color: var(--text); }
  .icon.del:hover { color: var(--err); border-color: var(--err); }

  .rename { display: flex; flex-direction: column; gap: 14px; }
  .rename input { height: 40px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 12px; font: inherit; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .modal-actions button { height: 38px; padding: 0 16px; border-radius: var(--r-control); font: inherit; cursor: pointer; }
  .ghost { background: transparent; border: 1px solid var(--border); color: var(--text-2); }
  .ghost:hover { background: var(--cell); color: var(--text); }
  .primary { background: var(--accent); border: none; color: #fff; font-weight: 600; }
  .primary:hover { background: var(--accent-hover); }
</style>
