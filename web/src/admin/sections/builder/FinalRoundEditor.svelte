<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import type { TemplateFinalRound, TemplateFinalTheme } from '../../lib/templateTypes.js';
  import { bankMediaUrl } from '../../bankApi.js';
  import QuestionPicker from './QuestionPicker.svelte';
  import { drag } from './SourceSidebar.svelte';
  import { uuid } from '../../../lib/uuid.js';

  export let round: TemplateFinalRound;
  export let questions: { id: string; categoryId: string; type: string; prompt: string; media: string | null }[] = [];
  export let categories: { id: string; name: string }[] = [];
  export let usedQuestionIds: Set<string> = new Set();
  export let questionInfo: (id: string) => { type: string; prompt: string; media: string | null } | undefined = () => undefined;

  const dispatch = createEventDispatcher<{ change: void }>();
  const uid = () => uuid();
  const changed = () => { round = round; dispatch('change'); };

  $: catNameById = new Map(categories.map(c => [c.id, c.name]));

  // ── выбор вопроса через модалку ──
  // scopeCategoryId: если задан — пикер показывает только вопросы этой категории (при перетаскивании);
  // иначе (клик по «выбрать вопрос») — все вопросы банка.
  let picker: { themeId: string; themeName: string; currentId: string | null; scopeCategoryId: string | null } | null = null;

  $: pickerQuestions = picker?.scopeCategoryId
    ? questions.filter(q => q.categoryId === picker!.scopeCategoryId)
    : questions;

  function openPicker(theme: TemplateFinalTheme) {
    picker = { themeId: theme.id, themeName: theme.name, currentId: theme.questionId, scopeCategoryId: null };
  }

  // Перетащили категорию из сайдбара на тему: тема становится «про эту категорию»
  // (имя = название категории) и сразу открывается пикер вопросов этой категории.
  function dropCategory(theme: TemplateFinalTheme) {
    const d = get(drag);
    if (d?.kind !== 'category') return;
    const name = catNameById.get(d.id) ?? theme.name;
    theme.name = name;
    changed();
    picker = { themeId: theme.id, themeName: name, currentId: theme.questionId, scopeCategoryId: d.id };
  }

  function onPick(qid: string) {
    if (!picker) return;
    const theme = round.themes.find(t => t.id === picker!.themeId);
    if (theme) theme.questionId = qid;
    picker = null;
    changed();
  }

  function onPickerClear() {
    if (!picker) return;
    const theme = round.themes.find(t => t.id === picker!.themeId);
    if (theme) theme.questionId = null;
    picker = null;
    changed();
  }

  function clearThemeQuestion(theme: TemplateFinalTheme) {
    theme.questionId = null;
    changed();
  }

  function addTheme() {
    const n = round.themes.length + 1;
    round.themes = [...round.themes, { id: uid(), name: `Тема ${n}`, questionId: null }];
    changed();
  }

  function removeTheme(themeId: string) {
    if (round.themes.length <= 2) return;
    round.themes = round.themes.filter(t => t.id !== themeId);
    changed();
  }
</script>

<div class="fre">
  <div class="fre-header">
    <h2 class="fre-title">Финальный раунд</h2>
    <span class="fre-hint">Каждый игрок делает ставку и пишет ответ самостоятельно</span>
  </div>

  <div class="themes-list">
    {#each round.themes as theme (theme.id)}
      <div class="theme-row">
        <div class="theme-name-wrap">
          <input
            class="theme-name"
            bind:value={theme.name}
            on:input={changed}
            placeholder="Название темы"
          />
        </div>

        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="theme-question"
          on:dragover|preventDefault
          on:drop|preventDefault={() => dropCategory(theme)}>
          {#if theme.questionId}
            {@const info = questionInfo(theme.questionId)}
            <div class="q-filled">
              <div class="q-preview">
                {#if info?.type === 'image' && info.media}
                  <img src={bankMediaUrl(info.media)} alt="" />
                {:else if info?.type === 'audio' && info.media}
                  <span class="q-icon">🔊</span><span class="q-text">{info.prompt?.slice(0, 60) || 'Аудио-вопрос'}</span>
                {:else}
                  <span class="q-text">{info?.prompt?.slice(0, 80) ?? '—'}</span>
                {/if}
              </div>
              <div class="q-actions">
                <button class="gear" title="Сменить вопрос" on:click={() => openPicker(theme)}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>
                  </svg>
                </button>
                <button class="x" title="Убрать вопрос" on:click={() => clearThemeQuestion(theme)}>×</button>
              </div>
            </div>
          {:else}
            <button class="q-empty" on:click={() => openPicker(theme)}>+ выбрать вопрос</button>
          {/if}
        </div>

        <button
          class="remove-theme"
          title="Удалить тему"
          disabled={round.themes.length <= 2}
          on:click={() => removeTheme(theme.id)}
        >−</button>
      </div>
    {/each}
  </div>

  <button class="add-theme" on:click={addTheme}>+ Тема</button>
</div>

{#if picker}
  <QuestionPicker
    categoryName={'Финал · ' + picker.themeName}
    questions={pickerQuestions}
    usedIds={usedQuestionIds}
    currentId={picker.currentId}
    on:select={(e) => onPick(e.detail)}
    on:clear={onPickerClear}
    on:close={() => (picker = null)}
  />
{/if}

<style>
  .fre { display: flex; flex-direction: column; gap: 16px; }

  .fre-header { display: flex; flex-direction: column; gap: 4px; }
  .fre-title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--gold);
    margin: 0;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .fre-hint { font-size: 13px; color: var(--text-3); }

  .themes-list { display: flex; flex-direction: column; gap: 8px; }

  .theme-row {
    display: grid;
    grid-template-columns: 14rem 1fr 2.5rem;
    gap: 8px;
    align-items: stretch;
  }

  .theme-name-wrap {
    display: flex;
    align-items: center;
  }
  .theme-name {
    width: 100%;
    background: var(--grad-rowlabel, var(--surface));
    border: 1px solid var(--border);
    border-radius: var(--r-control);
    color: var(--text);
    font-family: var(--font-display);
    font-size: 14px;
    padding: 10px 12px;
  }
  .theme-name:focus { outline: none; border-color: var(--border-accent); }

  .theme-question {
    background: var(--cell, var(--surface));
    border: 1px solid var(--border);
    border-radius: var(--r-control);
    min-height: 52px;
    display: flex;
    align-items: stretch;
  }

  .q-filled {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    width: 100%;
  }
  .q-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .q-preview img {
    max-height: 40px;
    max-width: 100%;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .q-icon { font-size: 18px; flex-shrink: 0; }
  .q-text {
    font-size: 13px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  .gear {
    width: 26px; height: 26px;
    display: grid; place-items: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-2);
    cursor: pointer;
  }
  .gear:hover { color: var(--accent); border-color: var(--border-accent); }

  .x {
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0 4px;
  }
  .x:hover { color: var(--err); }

  .q-empty {
    width: 100%;
    background: none;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    font: inherit;
    padding: 14px 16px;
    border-radius: var(--r-control);
    text-align: left;
  }
  .q-empty:hover { background: var(--cell-hover); color: var(--text-accent); }

  .remove-theme {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-control);
    color: var(--text);
    width: 2.5rem;
    cursor: pointer;
    font-size: 18px;
  }
  .remove-theme:hover:not(:disabled) { background: var(--cell-hover); color: var(--err); border-color: var(--err); }
  .remove-theme:disabled { opacity: .35; cursor: not-allowed; }

  .add-theme {
    align-self: flex-start;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--r-control);
    color: var(--text);
    padding: 10px 16px;
    cursor: pointer;
    font-family: var(--font-display);
  }
  .add-theme:hover { background: var(--cell-hover); border-color: var(--border-accent); }
</style>
