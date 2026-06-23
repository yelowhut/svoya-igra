<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Category } from '../bankApi.js';
  export let categories: Category[] = [];
  export let selectedId: string | null = null;
  const dispatch = createEventDispatcher<{
    select: string; create: string; rename: { id: string; name: string };
    move: { id: string; direction: 'up' | 'down' }; delete: Category;
  }>();

  let newName = '';
  function add() { const n = newName.trim(); if (!n) return; dispatch('create', n); newName = ''; }
  function rename(c: Category) {
    const name = prompt('Новое имя категории', c.name)?.trim();
    if (name && name !== c.name) dispatch('rename', { id: c.id, name });
  }
</script>

<div class="pane">
  <div class="head">
    <span class="title">Категории</span>
  </div>
  <form class="add" on:submit|preventDefault={add}>
    <input bind:value={newName} placeholder="Новая категория" />
    <button type="submit">+ Категория</button>
  </form>
  <ul>
    {#each categories as c (c.id)}
      <li class:active={c.id === selectedId}>
        <button class="name" on:click={() => dispatch('select', c.id)}>
          <span>{c.name}</span><span class="count">{c.questionCount}</span>
        </button>
        <div class="ops">
          <button class="sq" title="Вверх" on:click={() => dispatch('move', { id: c.id, direction: 'up' })}>↑</button>
          <button class="sq" title="Вниз" on:click={() => dispatch('move', { id: c.id, direction: 'down' })}>↓</button>
          <button title="Переименовать" on:click={() => rename(c)}>Имя</button>
          <button class="del" title="Удалить" on:click={() => dispatch('delete', c)}>Удалить</button>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { display: flex; gap: 8px; margin-bottom: 12px; }
  .add input { flex: 1; height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; }
  .add button { height: 36px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; align-items: center; gap: 6px; border-radius: var(--r-control); padding: 4px; }
  li.active { background: var(--cell-hover); border: 1px solid var(--border-accent); }
  .name { flex: 1; display: flex; justify-content: space-between; align-items: center; background: transparent; border: none; color: var(--text); font: inherit; cursor: pointer; padding: 6px 8px; text-align: left; }
  .count { color: var(--text-3); font-size: 12px; }
  .ops { display: flex; gap: 2px; }
  .ops button { height: 28px; padding: 0 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  .ops button.sq { width: 28px; padding: 0; }
  .ops button:hover { background: var(--cell); color: var(--text); }
  .ops .del:hover { color: var(--err); }
</style>
