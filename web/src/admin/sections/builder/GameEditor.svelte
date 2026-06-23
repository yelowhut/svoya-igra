<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import * as api from '../../templateApi.js';
  import * as bankApi from '../../bankApi.js';
  import { createDraft } from '../../lib/templateDraft.js';
  import type { GameTemplate } from '../../lib/templateTypes.js';
  import RoundGrid from './RoundGrid.svelte';
  import SourceSidebar from './SourceSidebar.svelte';

  export let id: string;
  const dispatch = createEventDispatcher<{ back: void }>();
  const uid = () => crypto.randomUUID();

  let draft: ReturnType<typeof createDraft> | null = null;
  let docVal: GameTemplate | null = null;
  let status: 'idle' | 'saving' | 'saved' = 'idle';
  let activeRound = 0;
  let bank = { categories: [] as { id: string; name: string }[], questions: [] as { id: string; categoryId: string; type: string; prompt: string; media: string | null }[] };

  onMount(async () => {
    const loaded = await api.getTemplate(id);
    draft = createDraft(id, loaded, d => api.saveTemplate(id, d));
    draft.doc.subscribe(v => (docVal = v));
    draft.status.subscribe(s => (status = s));

    // Загрузка банка вопросов для сайдбара
    const cats = await bankApi.listCategories();
    const qs = (await Promise.all(cats.map(c => bankApi.listQuestions(c.id)))).flat();
    bank = {
      categories: cats.map(c => ({ id: c.id, name: c.name })),
      questions: qs.map(q => ({ id: q.id, categoryId: q.categoryId, type: q.type, prompt: q.prompt, media: q.media ?? null }))
    };
  });

  function categoryName(cid: string | null): string {
    if (!cid) return '';
    return bank.categories.find(c => c.id === cid)?.name ?? cid;
  }

  function touch() { draft?.doc.update(d => d); draft?.touch(); }
  function addRound() {
    draft?.doc.update(d => { d.rounds = [...d.rounds, { id: uid(), name: `Раунд ${d.rounds.length + 1}`, columns: [], rows: [] }]; return d; });
    activeRound = (docVal?.rounds.length ?? 1) - 1;
    draft?.touch();
  }
</script>

<header class="bar">
  <button class="ghost" on:click={() => dispatch('back')}>← Список игр</button>
  {#if docVal}
    <input class="title" bind:value={docVal.title} on:input={touch} />
    <span class="save save-{status}">{status === 'saving' ? 'Сохранение…' : status === 'saved' ? 'Сохранено ✓' : ''}</span>
  {/if}
</header>

{#if docVal}
  <nav class="tabs">
    {#each docVal.rounds as r, i (r.id)}
      <button class:active={i === activeRound} on:click={() => (activeRound = i)}>{r.name}</button>
    {/each}
    <button class="add" on:click={addRound}>+ Раунд</button>
  </nav>

  {#if docVal.rounds[activeRound]}
    <div class="editor">
      <RoundGrid round={docVal.rounds[activeRound]} on:change={touch} {categoryName} questionInfo={(qid) => bank.questions.find(q => q.id === qid)} />
      <SourceSidebar {bank} />
    </div>
  {/if}
{/if}

<style>
  .editor { display: grid; grid-template-columns: 1fr 18rem; gap: 16px; align-items: start; }
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .title { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); font-family: var(--font-display); font-size: 20px; padding: 8px 12px; }
  .save { color: var(--text-2); font-size: 13px; min-width: 9rem; }
  .save-saved { color: var(--ok); }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .tabs button { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); padding: 8px 14px; cursor: pointer; font-family: var(--font-display); }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
</style>
