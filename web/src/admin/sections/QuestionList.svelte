<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Question } from '../bankApi.js';
  export let questions: Question[] = [];
  export let selectedId: string | null = null;
  export let categorySelected = false;
  const dispatch = createEventDispatcher<{
    select: string; create: void; reorder: string[]; delete: string;
  }>();
  const TYPE_LABEL: Record<Question['type'], string> = { text: 'Текст', image: 'Картинка', audio: 'Аудио' };

  let dragId: string | null = null;
  let overId: string | null = null;
  function onDrop(targetId: string) {
    overId = null;
    if (!dragId || dragId === targetId) { dragId = null; return; }
    const ids = questions.map(q => q.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { dragId = null; return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    dispatch('reorder', ids);
    dragId = null;
  }
</script>

<div class="pane">
  <div class="head">
    <span class="title">Вопросы</span>
    {#if categorySelected}<button class="add" on:click={() => dispatch('create')}>+ Вопрос</button>{/if}
  </div>

  {#if !categorySelected}
    <p class="empty">Выберите категорию слева.</p>
  {:else if questions.length === 0}
    <p class="empty">В категории пока нет вопросов.</p>
  {:else}
    <ul>
      {#each questions as q (q.id)}
        <li
          class:active={q.id === selectedId}
          class:over={q.id === overId && dragId !== q.id}
          class:dragging={q.id === dragId}
          draggable="true"
          on:dragstart={() => (dragId = q.id)}
          on:dragend={() => { dragId = null; overId = null; }}
          on:dragover|preventDefault={() => (overId = q.id)}
          on:dragleave={() => { if (overId === q.id) overId = null; }}
          on:drop|preventDefault={() => onDrop(q.id)}
        >
          <button class="card" on:click={() => dispatch('select', q.id)}>
            <span class="chip {q.type}">{TYPE_LABEL[q.type]}</span>
            <span class="prompt">{q.prompt || '— пустой вопрос —'}</span>
            <span class="answer">Ответ: {q.answer || '—'}</span>
          </button>
          <button class="trash" title="Удалить" on:click={() => dispatch('delete', q.id)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; min-width: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { height: 32px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  .empty { color: var(--text-3); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { position: relative; border-radius: var(--r-control); border: 1px solid transparent; cursor: grab; }
  li.over { border-color: var(--accent); }
  li.dragging { opacity: .45; }
  .card { width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 10px 44px 10px 12px; color: var(--text); font: inherit; cursor: pointer; min-width: 0; }
  li.active .card { border-color: var(--border-accent); background: var(--cell-hover); }
  .chip { align-self: flex-start; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: var(--r-pill); color: #0b0a12; font-weight: 700; }
  .chip.text { background: var(--accent); color: #fff; }
  .chip.image { background: var(--ok); }
  .chip.audio { background: var(--gold); }
  .prompt { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .answer { color: var(--text-3); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trash { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--panel); color: var(--text-3); border-radius: 8px; cursor: pointer; }
  .trash:hover { color: var(--err); border-color: var(--err); }
</style>
