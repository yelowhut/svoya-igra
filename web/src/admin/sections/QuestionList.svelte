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

  // ── drag&drop с линией-индикатором вставки ──
  let dragId: string | null = null;
  let dropIndex: number | null = null;
  function onDragOver(e: DragEvent, i: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = (e.clientY - r.top) > r.height / 2 ? i + 1 : i;
  }
  function onDrop() {
    if (dragId === null || dropIndex === null) return reset();
    const ids = questions.map(q => q.id);
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
      {#each questions as q, i (q.id)}
        <li
          class:active={q.id === selectedId}
          class:dragging={q.id === dragId}
          class:drop-before={dropIndex === i}
          class:drop-after={dropIndex === questions.length && i === questions.length - 1}
          draggable="true"
          on:dragstart={() => (dragId = q.id)}
          on:dragend={reset}
          on:dragover|preventDefault={(e) => onDragOver(e, i)}
          on:drop|preventDefault={onDrop}
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
  li.dragging { opacity: .4; }
  li.drop-before::before, li.drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--accent); border-radius: 2px; box-shadow: 0 0 6px var(--accent); z-index: 1; }
  li.drop-before::before { top: -5px; }
  li.drop-after::after { bottom: -5px; }
  .card { width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 10px 44px 10px 12px; color: var(--text); font: inherit; cursor: pointer; min-width: 0; }
  li.active .card { border-color: var(--border-accent); background: var(--cell-hover); }
  .chip { align-self: flex-start; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: var(--r-pill); color: #0b0a12; font-weight: 700; }
  .chip.text { background: var(--accent); color: #fff; }
  .chip.image { background: var(--ok); }
  .chip.audio { background: var(--gold); }
  .prompt { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .answer { color: var(--text-3); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trash { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--panel); color: var(--text-3); border-radius: 8px; cursor: pointer; z-index: 2; }
  .trash:hover { color: var(--err); border-color: var(--err); }
</style>
