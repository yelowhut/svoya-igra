<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as api from '../bankApi.js';
  import { bankMediaUrl, type Question, type QType } from '../bankApi.js';
  export let question: Question;
  const dispatch = createEventDispatcher<{ saved: void }>();

  let save: 'idle' | 'saving' | 'saved' = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;

  // локальные поля редактирования (инициализируются при смене вопроса)
  let type: QType = question.type;
  let prompt = question.prompt;
  let answer = question.answer;
  let media: string | null = question.media;
  let lastId = question.id;
  $: if (question.id !== lastId) { clearTimeout(timer); lastId = question.id; type = question.type; prompt = question.prompt; answer = question.answer; media = question.media; save = 'idle'; }

  const typeOptions: QType[] = ['text', 'image', 'audio'];

  async function persist(fields: Partial<Pick<Question, 'type' | 'prompt' | 'answer' | 'media'>>) {
    save = 'saving';
    try { await api.updateQuestion(question.id, fields); save = 'saved'; dispatch('saved'); }
    catch { save = 'idle'; }
  }
  function scheduleSave() {
    save = 'saving';
    clearTimeout(timer);
    timer = setTimeout(() => persist({ type, prompt, answer }), 400);
  }
  async function setType(t: QType) { type = t; await persist({ type: t, prompt, answer }); }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    save = 'saving';
    try { const { path } = await api.uploadMedia(question.id, file); media = path; save = 'saved'; dispatch('saved'); }
    catch (err) { alert((err as Error).message); save = 'idle'; }
    input.value = '';
  }
  async function clearMedia() { media = null; await persist({ media: null }); }
</script>

<div class="editor">
  <div class="bar">
    <span class="title">Редактор вопроса</span>
    <span class="save save-{save}">{save === 'saving' ? 'Сохранение…' : save === 'saved' ? 'Сохранено ✓' : ''}</span>
  </div>

  <div class="seg">
    {#each typeOptions as t}
      <button class:active={type === t} on:click={() => setType(t)}>
        {t === 'text' ? 'Текст' : t === 'image' ? 'Картинка' : 'Аудио'}
      </button>
    {/each}
  </div>

  {#if type !== 'text'}
    <div class="media">
      {#if media}
        {#if type === 'image'}<img src={bankMediaUrl(media)} alt="" />{/if}
        {#if type === 'audio'}<audio controls src={bankMediaUrl(media)}></audio>{/if}
        <button class="link" on:click={clearMedia}>Убрать файл</button>
      {:else}
        <label class="upload">
          {type === 'image' ? 'Загрузить картинку' : 'Загрузить аудио'}
          <input type="file" accept={type === 'image' ? 'image/*' : 'audio/*'} on:change={onFile} hidden />
        </label>
      {/if}
    </div>
  {/if}

  <label class="field">Текст вопроса
    <textarea rows="3" bind:value={prompt} on:input={scheduleSave}></textarea>
  </label>
  <label class="field">Ответ (видит только ведущий)
    <input class="answer" bind:value={answer} on:input={scheduleSave} />
  </label>
</div>

<style>
  .editor { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--text-2); font-size: 12px; }
  .save { font-size: 12px; color: var(--text-3); min-height: 16px; }
  .save-saved { color: var(--ok); }
  .seg { display: inline-flex; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px; width: fit-content; }
  .seg button { border: none; background: transparent; color: var(--text-2); font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer; }
  .seg button.active { background: var(--accent); color: #fff; }
  .media { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .media img { max-width: 320px; max-height: 200px; border-radius: var(--r-control); border: 1px solid var(--border); }
  .upload { display: inline-block; padding: 10px 14px; border: 1px dashed var(--border-accent); border-radius: var(--r-control); color: var(--text-accent); cursor: pointer; }
  .link { background: none; border: none; color: var(--text-3); cursor: pointer; text-decoration: underline; font: inherit; padding: 0; }
  .field { display: flex; flex-direction: column; gap: 6px; color: var(--text-2); font-size: 13px; }
  textarea, .answer { border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 10px 12px; font: inherit; resize: vertical; }
  .answer { color: var(--gold); }
</style>
