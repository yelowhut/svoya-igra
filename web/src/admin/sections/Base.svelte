<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../bankApi.js';
  import type { Category, Question } from '../bankApi.js';
  import CategoryList from './CategoryList.svelte';
  import QuestionList from './QuestionList.svelte';
  import QuestionEditor from './QuestionEditor.svelte';
  import Modal from './Modal.svelte';

  let categories: Category[] = [];
  let selectedCategoryId: string | null = null;
  let questions: Question[] = [];
  let selectedQuestionId: string | null = null;
  $: selectedQuestion = questions.find(q => q.id === selectedQuestionId) ?? null;
  let error = '';

  async function reloadCategories() {
    try { categories = await api.listCategories(); } catch (e) { error = (e as Error).message; }
  }
  async function reloadQuestions() {
    if (!selectedCategoryId) { questions = []; return; }
    try { questions = await api.listQuestions(selectedCategoryId); } catch (e) { error = (e as Error).message; }
  }

  onMount(reloadCategories);

  async function selectCategory(id: string) {
    selectedCategoryId = id; selectedQuestionId = null;
    await reloadQuestions();
  }
  async function createCategory(name: string) { await api.createCategory(name); await reloadCategories(); }
  async function renameCategory(id: string, name: string) { await api.renameCategory(id, name); await reloadCategories(); }
  async function reorderCategories(ids: string[]) { await api.reorderCategories(ids); await reloadCategories(); }
  let pendingDelete:
    | { kind: 'category'; cat: Category }
    | { kind: 'question'; id: string; label: string }
    | null = null;
  function askDeleteCategory(c: Category) { pendingDelete = { kind: 'category', cat: c }; }
  function askDeleteQuestion(id: string) {
    const q = questions.find(x => x.id === id);
    pendingDelete = { kind: 'question', id, label: q?.prompt?.trim() || 'Без текста' };
  }
  async function confirmDelete() {
    const pd = pendingDelete;
    if (!pd) return;
    pendingDelete = null;
    if (pd.kind === 'category') {
      await api.deleteCategory(pd.cat.id);
      if (selectedCategoryId === pd.cat.id) { selectedCategoryId = null; questions = []; selectedQuestionId = null; }
      await reloadCategories();
    } else {
      await api.deleteQuestion(pd.id);
      if (selectedQuestionId === pd.id) selectedQuestionId = null;
      await reloadQuestions(); await reloadCategories();
    }
  }

  async function createQuestion() {
    if (!selectedCategoryId) return;
    const { id } = await api.createQuestion(selectedCategoryId);
    await reloadQuestions(); await reloadCategories();
    selectedQuestionId = id;
  }
  async function reorderQuestions(ids: string[]) { if (!selectedCategoryId) return; await api.reorderQuestions(selectedCategoryId, ids); await reloadQuestions(); }

  async function onImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try { await api.importBank(file); await reloadCategories(); await reloadQuestions(); }
    catch (err) { error = (err as Error).message; }
    input.value = '';
  }
  async function onSaved() { await reloadQuestions(); await reloadCategories(); }
</script>

<section class="base">
  <header class="bar">
    <h1>База вопросов</h1>
    <div class="actions">
      <label class="btn">Импорт<input type="file" accept=".zip,application/zip" on:change={onImport} hidden /></label>
      <a class="btn" href={api.EXPORT_URL}>Экспорт</a>
    </div>
  </header>
  {#if error}<p class="err">{error}</p>{/if}

  <div class="cols">
    <CategoryList
      {categories} selectedId={selectedCategoryId}
      on:select={(e) => selectCategory(e.detail)}
      on:create={(e) => createCategory(e.detail)}
      on:rename={(e) => renameCategory(e.detail.id, e.detail.name)}
      on:reorder={(e) => reorderCategories(e.detail)}
      on:delete={(e) => askDeleteCategory(e.detail)}
    />
    <QuestionList
      {questions} selectedId={selectedQuestionId} categorySelected={!!selectedCategoryId}
      on:select={(e) => selectedQuestionId = e.detail}
      on:create={createQuestion}
      on:reorder={(e) => reorderQuestions(e.detail)}
      on:delete={(e) => askDeleteQuestion(e.detail)}
    />
    {#if selectedQuestion}
      <QuestionEditor question={selectedQuestion} on:saved={onSaved} />
    {/if}
  </div>
</section>

{#if pendingDelete}
  <Modal
    title={pendingDelete.kind === 'category' ? 'Удалить категорию?' : 'Удалить вопрос?'}
    on:close={() => (pendingDelete = null)}
  >
    {#if pendingDelete.kind === 'category'}
      <p>«{pendingDelete.cat.name}» и {pendingDelete.cat.questionCount} вопросов будут удалены безвозвратно.</p>
    {:else}
      <p>«{pendingDelete.label}» будет удалён безвозвратно.</p>
    {/if}
    <div class="modal-actions">
      <button class="ghost" on:click={() => (pendingDelete = null)}>Отмена</button>
      <button class="primary" on:click={confirmDelete}>Удалить</button>
    </div>
  </Modal>
{/if}

<style>
  .base { display: flex; flex-direction: column; gap: 16px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .err { color: var(--err); margin: 0; }
  .cols { display: grid; grid-template-columns: 350px minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .actions { display: flex; gap: 8px; }
  .btn { height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; text-decoration: none; }
  .btn:hover { background: var(--cell); }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
</style>
