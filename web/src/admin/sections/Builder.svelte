<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../templateApi.js';
  import Modal from './Modal.svelte';
  import GameEditor from './builder/GameEditor.svelte';

  let view: 'list' | 'edit' = 'list';
  let editingId: string | null = null;
  let games: { id: string; title: string; updatedAt: number }[] = [];
  let deleting: { id: string; title: string } | null = null;

  async function reload() { games = await api.listTemplates(); }
  onMount(reload);

  async function create(template?: '5x5') {
    const { id } = await api.createTemplate(template);
    open(id);
  }
  function open(id: string) { editingId = id; view = 'edit'; }
  async function confirmDelete() {
    if (!deleting) return;
    await api.deleteTemplate(deleting.id);
    deleting = null;
    await reload();
  }
  async function back() { view = 'list'; editingId = null; await reload(); }
</script>

{#if view === 'edit' && editingId}
  <GameEditor id={editingId} on:back={back} />
{:else}
  <section>
    <header class="head">
      <h1>Конструктор</h1>
      <div class="actions">
        <button class="ghost" on:click={() => create()}>Пустая игра</button>
        <button class="primary" on:click={() => create('5x5')}>Новая 5×5</button>
      </div>
    </header>

    {#if games.length === 0}
      <p class="muted">Пока нет игр. Создайте пустую или 5×5.</p>
    {:else}
      <ul class="games">
        {#each games as g (g.id)}
          <li>
            <button class="card" on:click={() => open(g.id)}>{g.title}</button>
            <button class="icon del" title="Удалить" on:click={() => (deleting = { id: g.id, title: g.title })}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor">
                <path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>
              </svg>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if deleting}
    <Modal title="Удалить игру?" on:close={() => (deleting = null)}>
      <p>«{deleting.title}» будет удалена безвозвратно.</p>
      <p class="warn">Если игра опубликована — публикация снимется, пак исчезнет из выбора, а активные игры на нём завершатся.</p>
      <div class="modal-actions">
        <button class="ghost" on:click={() => (deleting = null)}>Отмена</button>
        <button class="primary" on:click={confirmDelete}>Удалить</button>
      </div>
    </Modal>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .actions { display: flex; gap: 8px; }
  .muted { color: var(--text-2); }
  .games { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .games li { display: flex; gap: 8px; align-items: center; }
  .card { flex: 1; text-align: left; padding: 14px 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-card); color: var(--text); font-family: var(--font-display); font-size: 16px; cursor: pointer; }
  .card:hover { background: var(--cell-hover); }
  .icon.del { background: none; border: none; color: var(--text-2); cursor: pointer; padding: 8px; }
  .icon.del:hover { color: var(--err); }
  .warn { color: var(--text-2); font-size: 13px; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
