<script lang="ts">
  import { onMount } from 'svelte';
  import * as api from '../bankApi.js';
  import type { Category, Question } from '../bankApi.js';
  import CategoryList from './CategoryList.svelte';
  import QuestionList from './QuestionList.svelte';
  import QuestionEditor from './QuestionEditor.svelte';

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
  async function moveCategory(id: string, direction: 'up' | 'down') { await api.moveCategory(id, direction); await reloadCategories(); }
  async function deleteCategory(c: Category) {
    if (!confirm(`Удалить категорию «${c.name}» и ${c.questionCount} вопросов?`)) return;
    await api.deleteCategory(c.id);
    if (selectedCategoryId === c.id) { selectedCategoryId = null; questions = []; selectedQuestionId = null; }
    await reloadCategories();
  }

  async function createQuestion() {
    if (!selectedCategoryId) return;
    const { id } = await api.createQuestion(selectedCategoryId);
    await reloadQuestions(); await reloadCategories();
    selectedQuestionId = id;
  }
  async function moveQuestion(id: string, direction: 'up' | 'down') { await api.moveQuestion(id, direction); await reloadQuestions(); }
  async function deleteQuestion(id: string) {
    if (!confirm('Удалить вопрос?')) return;
    await api.deleteQuestion(id);
    if (selectedQuestionId === id) selectedQuestionId = null;
    await reloadQuestions(); await reloadCategories();
  }

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
      on:move={(e) => moveCategory(e.detail.id, e.detail.direction)}
      on:delete={(e) => deleteCategory(e.detail)}
    />
    <QuestionList
      {questions} selectedId={selectedQuestionId} categorySelected={!!selectedCategoryId}
      on:select={(e) => selectedQuestionId = e.detail}
      on:create={createQuestion}
      on:move={(e) => moveQuestion(e.detail.id, e.detail.direction)}
      on:delete={(e) => deleteQuestion(e.detail)}
    />
    {#if selectedQuestion}
      <QuestionEditor question={selectedQuestion} on:saved={onSaved} />
    {/if}
  </div>
</section>

<style>
  .base { display: flex; flex-direction: column; gap: 16px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; margin: 0; }
  .err { color: var(--err); margin: 0; }
  .cols { display: grid; grid-template-columns: 280px minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .actions { display: flex; gap: 8px; }
  .btn { height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; text-decoration: none; }
  .btn:hover { background: var(--cell); }
</style>
