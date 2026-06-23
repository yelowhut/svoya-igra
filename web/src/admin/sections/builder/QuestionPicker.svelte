<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from '../Modal.svelte';
  import { bankMediaUrl } from '../../bankApi.js';

  export let categoryName: string;
  export let questions: { id: string; type: string; prompt: string; media: string | null }[] = [];
  export let usedIds: Set<string> = new Set();
  export let currentId: string | null = null;

  const dispatch = createEventDispatcher<{ select: string; clear: void; close: void }>();
  const typeIcon = (t: string) => (t === 'image' ? '🖼' : t === 'audio' ? '🔊' : 'A');

  function pick(q: { id: string }) {
    if (usedIds.has(q.id) && q.id !== currentId) return; // занят в другой ячейке
    dispatch('select', q.id);
  }
</script>

<Modal title={`Категория: ${categoryName}`} on:close={() => dispatch('close')}>
  {#if questions.length === 0}
    <p class="empty">В этой категории пока нет вопросов. Добавьте их в «Базе вопросов».</p>
  {:else}
    <ul class="list">
      {#each questions as q (q.id)}
        {@const used = usedIds.has(q.id) && q.id !== currentId}
        <li>
          <button
            class="row"
            class:current={q.id === currentId}
            class:used
            disabled={used}
            on:click={() => pick(q)}
          >
            <span class="type">{typeIcon(q.type)}</span>
            <span class="prompt">
              {#if q.type === 'image' && q.media}
                <img src={bankMediaUrl(q.media)} alt="" />
              {:else if q.type === 'audio'}
                {q.prompt?.trim() || '🔊 аудио-вопрос'}
              {:else}
                {q.prompt?.trim() || '(без текста)'}
              {/if}
            </span>
            {#if q.id === currentId}
              <span class="badge cur">текущий</span>
            {:else if used}
              <span class="badge">занят</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    {#if currentId}
      <button class="ghost" on:click={() => dispatch('clear')}>Убрать вопрос</button>
    {/if}
    <button class="ghost" on:click={() => dispatch('close')}>Закрыть</button>
  </div>
</Modal>

<style>
  .empty { color: var(--text-3); margin: 0 0 12px; }
  .list { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 6px;
    max-height: 50vh; overflow-y: auto; }
  .row { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); font: inherit; padding: 9px 11px; cursor: pointer; min-width: 0; }
  .row:hover:not(:disabled) { background: var(--cell-hover); border-color: var(--border-accent); }
  .row.current { border-color: var(--accent); background: var(--cell-hover); }
  .row.used { opacity: .45; cursor: not-allowed; }
  .type { color: var(--accent); font-weight: 700; flex-shrink: 0; width: 1.4rem; text-align: center; }
  .prompt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prompt img { max-height: 40px; max-width: 100%; border-radius: 6px; vertical-align: middle; }
  .badge { flex-shrink: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .03em;
    color: var(--text-3); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 2px 8px; }
  .badge.cur { color: var(--accent); border-color: var(--border-accent); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
