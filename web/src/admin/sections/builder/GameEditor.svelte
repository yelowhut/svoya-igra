<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import * as api from '../../templateApi.js';
  import * as bankApi from '../../bankApi.js';
  import { createDraft } from '../../lib/templateDraft.js';
  import { validateClient, summarize, type BankClientView } from '../../lib/templateValidate.js';
  import type { GameTemplate } from '../../lib/templateTypes.js';
  import RoundGrid from './RoundGrid.svelte';
  import SourceSidebar from './SourceSidebar.svelte';
  import Modal from '../Modal.svelte';

  export let id: string;
  const dispatch = createEventDispatcher<{ back: void }>();
  const uid = () => crypto.randomUUID();

  let draft: ReturnType<typeof createDraft> | null = null;
  let docVal: GameTemplate | null = null;
  let status: 'idle' | 'saving' | 'saved' = 'idle';
  let activeRound = 0;
  let bank = { categories: [] as { id: string; name: string }[], questions: [] as { id: string; categoryId: string; type: string; prompt: string; media: string | null }[] };

  let publishModal: { referencingGames: number } | null = null;
  let publishError: string | null = null;
  let bankView: BankClientView = { categories: new Set(), questionCategory: new Map() };

  let _unsubDoc: (() => void) | null = null;
  let _unsubStatus: (() => void) | null = null;
  onMount(() => {
    api.getTemplate(id).then(loaded => {
      draft = createDraft(id, loaded, d => api.saveTemplate(id, d));
      _unsubDoc = draft.doc.subscribe(v => (docVal = v));
      _unsubStatus = draft.status.subscribe(s => (status = s));
    });

    // Загрузка банка вопросов для сайдбара
    // (moved inside the async block below)
    (async () => {
      const cats = await bankApi.listCategories();
      const qs = (await Promise.all(cats.map(c => bankApi.listQuestions(c.id)))).flat();
      bank = {
        categories: cats.map(c => ({ id: c.id, name: c.name })),
        questions: qs.map(q => ({ id: q.id, categoryId: q.categoryId, type: q.type, prompt: q.prompt, media: q.media ?? null }))
      };
      bankView = {
        categories: new Set(bank.categories.map(c => c.id)),
        questionCategory: new Map(bank.questions.map(q => [q.id, q.categoryId]))
      };
    })();

    return () => { _unsubDoc?.(); _unsubStatus?.(); };
  });

  $: validation = docVal ? validateClient(docVal, bankView) : { errors: [], warnings: [] };
  $: summary = summarize(validation.errors);
  $: canPublish = !!docVal && validation.errors.length === 0;

  // Вопросы, уже занятые в любой ячейке любого раунда (для пометки в пикере).
  $: usedQuestionIds = new Set(
    (docVal?.rounds ?? [])
      .flatMap(r => r.rows.flatMap(row => row.cells))
      .map(c => c.questionId)
      .filter((x): x is string => !!x)
  );
  $: questionsOf = (categoryId: string) => bank.questions.filter(q => q.categoryId === categoryId);

  function touch() { draft?.doc.update(d => d); draft?.touch(); }
  function addRound() {
    draft?.doc.update(d => { d.rounds = [...d.rounds, { id: uid(), name: `Раунд ${d.rounds.length + 1}`, columns: [], rows: [] }]; return d; });
    activeRound = (docVal?.rounds.length ?? 1) - 1;
    draft?.touch();
  }

  let roundToDelete: { index: number; name: string } | null = null;
  function askRemoveRound(i: number) {
    const r = docVal?.rounds[i];
    if (r) roundToDelete = { index: i, name: r.name };
  }
  function confirmRemoveRound() {
    if (!roundToDelete) return;
    const idx = roundToDelete.index;
    draft?.doc.update(d => { d.rounds = d.rounds.filter((_, i) => i !== idx); return d; });
    const last = (docVal?.rounds.length ?? 1) - 1;
    if (activeRound > last) activeRound = Math.max(0, last);
    roundToDelete = null;
    draft?.touch();
  }

  async function playTest() {
    if (!draft || !docVal) return;
    publishError = null;
    await draft.flush();
    const mode = docVal.lastPublishedPackId ? 'overwrite' : 'new';
    const { packId } = await api.publish(id, mode);
    const { gameId } = await api.createGame(packId, docVal.title, 3);
    window.open(`/host?game=${gameId}`, '_blank');
    window.open(`/board?game=${gameId}`, '_blank');
  }

  async function startPublish() {
    if (!draft) return;
    publishError = null;
    await draft.flush();
    const pf = await api.preflight(id);
    publishModal = { referencingGames: pf.referencingGames };
  }

  async function doPublish(mode: 'new' | 'overwrite') {
    try { await api.publish(id, mode); publishModal = null; }
    catch (e) {
      publishModal = null;
      const problems: { kind: string }[] | undefined = (e as Error & { problems?: { kind: string }[] }).problems;
      if (problems && problems.length > 0) {
        const missingMedia = problems.filter(p => p.kind === 'cell-missing-media').length;
        if (missingMedia > 0) {
          publishError = `Не удалось опубликовать: отсутствуют медиа-файлы у ${missingMedia} вопросов`;
        } else {
          publishError = `Не удалось опубликовать: ${problems.length} ошибок валидации`;
        }
      } else {
        publishError = `Не удалось опубликовать: ${(e as Error).message ?? 'неизвестная ошибка'}`;
      }
    }
  }
</script>

<header class="bar">
  <button class="ghost" on:click={() => dispatch('back')}>← Список игр</button>
  {#if docVal}
    <input class="title" bind:value={docVal.title} on:input={touch} />
    <span class="save save-{status}">{status === 'saving' ? 'Сохранение…' : status === 'saved' ? 'Сохранено ✓' : ''}</span>
  {/if}
  <button class="ghost" on:click={playTest} disabled={!docVal}>Сыграть тестовую</button>
  <button class="primary" on:click={startPublish} disabled={!canPublish}>Опубликовать</button>
</header>

{#if docVal}
  <nav class="tabs">
    {#each docVal.rounds as r, i (r.id)}
      <div class="tab" class:active={i === activeRound}>
        <button class="tabname" on:click={() => (activeRound = i)}>{r.name}</button>
        {#if docVal.rounds.length > 1}
          <button class="tabdel" title="Удалить раунд" on:click={() => askRemoveRound(i)}>×</button>
        {/if}
      </div>
    {/each}
    <button class="add" on:click={addRound}>+ Раунд</button>
  </nav>

  {#if docVal.rounds[activeRound]}
    <div class="editor">
      <RoundGrid
        round={docVal.rounds[activeRound]}
        roundNumber={activeRound + 1}
        on:change={touch}
        categories={bank.categories}
        questionInfo={(qid) => bank.questions.find(q => q.id === qid)}
        {questionsOf}
        {usedQuestionIds}
      />
      <SourceSidebar {bank} />
    </div>
  {/if}

  {#if validation.errors.length}
    <div class="banner warn">Что мешает опубликовать: строк без категории {summary.rowsNoCategory} · пустых ячеек {summary.emptyCells}</div>
  {:else}
    <div class="banner ok">Всё заполнено — можно публиковать</div>
  {/if}
{/if}

{#if publishError}
  <div class="banner warn">{publishError}</div>
{/if}

{#if roundToDelete}
  <Modal title="Удалить раунд?" on:close={() => (roundToDelete = null)}>
    <p>«{roundToDelete.name}» и все назначенные в нём вопросы будут удалены.</p>
    <div class="modal-actions">
      <button class="ghost" on:click={() => (roundToDelete = null)}>Отмена</button>
      <button class="primary" on:click={confirmRemoveRound}>Удалить</button>
    </div>
  </Modal>
{/if}

{#if publishModal}
  <Modal title="Публикация" on:close={() => (publishModal = null)}>
    {#if publishModal.referencingGames > 0}
      <p>{publishModal.referencingGames} активных игр на этом паке будут завершены.</p>
    {/if}
    <div class="modal-actions">
      <button class="ghost" on:click={() => (publishModal = null)}>Отмена</button>
      <button class="ghost" on:click={() => doPublish('overwrite')} disabled={!docVal?.lastPublishedPackId}>Перезаписать текущую</button>
      <button class="primary" on:click={() => doPublish('new')}>Новый пак</button>
    </div>
  </Modal>
{/if}

<style>
  .editor { display: grid; grid-template-columns: 1fr 18rem; gap: 16px; align-items: start; }
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .title { flex: 1; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); font-family: var(--font-display); font-size: 20px; padding: 8px 12px; }
  .save { color: var(--text-2); font-size: 13px; min-width: 9rem; }
  .save-saved { color: var(--ok); }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .tab { display: inline-flex; align-items: center; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--r-control); overflow: hidden; }
  .tab.active { border-color: var(--accent); }
  .tabname { background: none; border: none; color: var(--text); padding: 8px 6px 8px 14px;
    cursor: pointer; font-family: var(--font-display); }
  .tab.active .tabname { color: var(--accent); }
  .tabdel { background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 18px;
    line-height: 1; padding: 8px 10px 8px 4px; }
  .tabdel:hover { color: var(--err); }
  .tabs .add { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); padding: 8px 14px; cursor: pointer; font-family: var(--font-display); }
  .banner { margin-top: 16px; padding: 10px 14px; border-radius: var(--r-control); font-family: var(--font-display); }
  .banner.warn { background: rgba(245,197,24,.12); color: var(--gold); border: 1px solid var(--gold); }
  .banner.ok { background: rgba(31,209,142,.12); color: var(--ok); border: 1px solid var(--ok); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
