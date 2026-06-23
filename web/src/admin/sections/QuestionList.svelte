<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Question } from '../bankApi.js';
  export let questions: Question[] = [];
  export let selectedId: string | null = null;
  export let categorySelected = false;
  const dispatch = createEventDispatcher<{
    select: string; create: void;
    move: { id: string; direction: 'up' | 'down' }; delete: string;
  }>();
  const TYPE_LABEL: Record<Question['type'], string> = { text: 'Текст', image: 'Картинка', audio: 'Аудио' };
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
        <li class:active={q.id === selectedId}>
          <button class="card" on:click={() => dispatch('select', q.id)}>
            <span class="chip {q.type}">{TYPE_LABEL[q.type]}</span>
            <span class="prompt">{q.prompt || '— пустой вопрос —'}</span>
            <span class="answer">Ответ: {q.answer || '—'}</span>
          </button>
          <div class="ops">
            <button class="sq" title="Вверх" on:click={() => dispatch('move', { id: q.id, direction: 'up' })}>↑</button>
            <button class="sq" title="Вниз" on:click={() => dispatch('move', { id: q.id, direction: 'down' })}>↓</button>
            <button class="del" title="Удалить" on:click={() => dispatch('delete', q.id)}>Удалить</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .add { height: 32px; padding: 0 12px; border: none; border-radius: var(--r-control); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
  .empty { color: var(--text-3); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { display: flex; gap: 6px; align-items: stretch; }
  .card { flex: 1; display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 10px 12px; color: var(--text); font: inherit; cursor: pointer; }
  li.active .card { border-color: var(--border-accent); background: var(--cell-hover); }
  .chip { align-self: flex-start; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 2px 8px; border-radius: var(--r-pill); color: #0b0a12; font-weight: 700; }
  .chip.text { background: var(--accent); color: #fff; }
  .chip.image { background: var(--ok); }
  .chip.audio { background: var(--gold); }
  .prompt { font-weight: 600; }
  .answer { color: var(--text-3); font-size: 13px; }
  .ops { display: flex; flex-direction: column; gap: 2px; }
  .ops button { height: 28px; padding: 0 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  .ops button.sq { width: 28px; padding: 0; }
  .ops button:hover { background: var(--cell); color: var(--text); }
  .ops .del:hover { color: var(--err); }
</style>
