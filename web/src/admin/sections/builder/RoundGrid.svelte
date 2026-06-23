<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import type { TemplateRound, TemplateRow, TemplateCell } from '../../lib/templateTypes.js';
  import { drag } from './SourceSidebar.svelte';
  import { bankMediaUrl } from '../../bankApi.js';
  import QuestionPicker from './QuestionPicker.svelte';

  export let round: TemplateRound;
  export let roundNumber: number = 1;
  // Данные категорий (не функция) — чтобы названия были реактивны к загрузке банка.
  export let categories: { id: string; name: string }[] = [];
  export let questionInfo: (id: string) => { type: string; prompt: string; media: string | null } | undefined = () => undefined;
  export let questionsOf: (categoryId: string) => { id: string; type: string; prompt: string; media: string | null }[] = () => [];
  export let usedQuestionIds: Set<string> = new Set();

  const dispatch = createEventDispatcher<{ change: void }>();
  const uid = () => crypto.randomUUID();
  const changed = () => { round = round; dispatch('change'); };

  $: nameById = new Map(categories.map(c => [c.id, c.name]));
  const catLabel = (id: string | null) => (id ? nameById.get(id) ?? id : '');

  const TAGS = ['none', 'cat', 'auction'] as const;
  function cycleTag(cell: TemplateCell) {
    if (!cell.questionId) return;
    cell.special = TAGS[(TAGS.indexOf(cell.special) + 1) % TAGS.length];
    changed();
  }
  const tagLabel = (s: string) => s === 'cat' ? 'Кот' : s === 'auction' ? 'Аукцион' : '';
  function clearCell(cell: TemplateCell) { cell.questionId = null; cell.special = 'none'; changed(); }

  // ── выбор вопроса через модалку ──
  let picker: { rowId: string; columnId: string; categoryId: string; currentId: string | null } | null = null;
  function openPicker(row: TemplateRow, cell: TemplateCell) {
    if (!row.categoryId) return;
    picker = { rowId: row.id, columnId: cell.columnId, categoryId: row.categoryId, currentId: cell.questionId };
  }
  function findCell(rowId: string, columnId: string): TemplateCell | undefined {
    return round.rows.find(r => r.id === rowId)?.cells.find(c => c.columnId === columnId);
  }
  function onPick(qid: string) {
    if (!picker) return;
    const cell = findCell(picker.rowId, picker.columnId);
    if (cell) cell.questionId = qid;
    picker = null; changed();
  }
  function onPickerClear() {
    if (!picker) return;
    const cell = findCell(picker.rowId, picker.columnId);
    if (cell) { cell.questionId = null; cell.special = 'none'; }
    picker = null; changed();
  }

  // ── drag&drop категории на строку ──
  function dropCategory(row: TemplateRow) {
    const d = get(drag);
    if (d?.kind !== 'category') return;
    row.categoryId = d.id;
    row.cells = row.cells.map(c => ({ ...c, questionId: null, special: 'none' as const }));
    changed();
  }

  function addColumn() {
    const col = { id: uid(), value: 100 * roundNumber * (round.columns.length + 1) };
    round.columns = [...round.columns, col];
    round.rows = round.rows.map(r => ({ ...r, cells: [...r.cells, { columnId: col.id, questionId: null, special: 'none' as const }] }));
    changed();
  }
  function removeColumn(colId: string) {
    round.columns = round.columns.filter(c => c.id !== colId);
    round.rows = round.rows.map(r => ({ ...r, cells: r.cells.filter(c => c.columnId !== colId) }));
    changed();
  }
  function setValue(colId: string, v: number) {
    const col = round.columns.find(c => c.id === colId);
    if (col) { col.value = v; changed(); }
  }
  function addRow() {
    const row: TemplateRow = { id: uid(), categoryId: null, cells: round.columns.map(c => ({ columnId: c.id, questionId: null, special: 'none' })) };
    round.rows = [...round.rows, row];
    changed();
  }
  function removeRow(rowId: string) { round.rows = round.rows.filter(r => r.id !== rowId); changed(); }
  function onPriceInput(colId: string, e: Event) {
    setValue(colId, Number((e.target as HTMLInputElement).value));
  }
</script>

<div class="grid">
  <div class="row header" style="grid-template-columns:10rem repeat({round.columns.length}, 1fr) 2.5rem">
    <div class="corner">Категория</div>
    {#each round.columns as col (col.id)}
      <div class="colhead">
        <input class="price" type="number" min="100" step="100" value={col.value}
          on:input={(e) => onPriceInput(col.id, e)} />
        <button class="mini" title="Убрать столбец" on:click={() => removeColumn(col.id)}>−</button>
      </div>
    {/each}
    <button class="mini add" title="Добавить столбец" on:click={addColumn}>+</button>
  </div>

  {#each round.rows as row (row.id)}
    <div class="row" style="grid-template-columns:10rem repeat({round.columns.length}, 1fr) 2.5rem">
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="cat" on:dragover|preventDefault on:drop|preventDefault={() => dropCategory(row)}>
        {#if row.categoryId}<span class="catname">{nameById.get(row.categoryId) ?? row.categoryId}</span>{:else}<span class="dashed">Перетащите категорию</span>{/if}
        <button class="mini" title="Убрать строку" on:click={() => removeRow(row.id)}>−</button>
      </div>
      {#each row.cells as cell (cell.columnId)}
        <div class="cell">
          {#if cell.questionId}
            {@const info = questionInfo(cell.questionId)}
            <div class="filled">
              <button class="gear" title="Сменить вопрос" on:click={() => openPicker(row, cell)} disabled={!row.categoryId}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>
                </svg>
              </button>
              {#if info?.type === 'image' && info.media}<img src={bankMediaUrl(info.media)} alt="" />
              {:else if info?.type === 'audio' && info.media}<audio controls src={bankMediaUrl(info.media)}></audio>
              {:else}<span class="prompt">{info?.prompt?.slice(0, 40) ?? '—'}</span>{/if}
              <div class="cellbar">
                <button class="tag" on:click={() => cycleTag(cell)}>{tagLabel(cell.special) || 'тег'}</button>
                <button class="x" title="Очистить ячейку" on:click={() => clearCell(cell)}>×</button>
              </div>
            </div>
          {:else if row.categoryId}
            <button class="empty" on:click={() => openPicker(row, cell)}>+ выбрать вопрос</button>
          {:else}
            <span class="nocat">Сначала категория</span>
          {/if}
        </div>
      {/each}
      <div></div>
    </div>
  {/each}

  <button class="addrow" on:click={addRow}>+ Строка</button>
</div>

{#if picker}
  <QuestionPicker
    categoryName={catLabel(picker.categoryId)}
    questions={questionsOf(picker.categoryId)}
    usedIds={usedQuestionIds}
    currentId={picker.currentId}
    on:select={(e) => onPick(e.detail)}
    on:clear={onPickerClear}
    on:close={() => (picker = null)}
  />
{/if}

<style>
  .grid { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: stretch; }
  .corner, .cat { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .03em;
    background: var(--grad-rowlabel); border: 1px solid var(--border); border-radius: var(--r-control);
    padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .catname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dashed { color: var(--text-3); font-size: 13px; }
  .colhead { display: flex; gap: 4px; align-items: center; }
  .price { width: 100%; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--gold); font-family: var(--font-display); font-size: 20px; font-weight: 700; text-align: center; padding: 8px; }
  .cell { position: relative; padding: 0; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    min-height: 56px; color: var(--text-2); text-align: center; display: flex; }
  .mini { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 18px; flex-shrink: 0; }
  .mini:hover { background: var(--cell-hover); }
  .addrow { justify-self: start; background: var(--surface); border: 1px dashed var(--border);
    border-radius: var(--r-control); color: var(--text); padding: 10px 16px; cursor: pointer; }
  .filled { position: relative; display: grid; gap: 6px; padding: 14px; width: 100%; }
  .filled img { max-width: 100%; max-height: 64px; border-radius: 6px; }
  .gear { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; display: grid; place-items: center;
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px; color: var(--text-2); cursor: pointer; z-index: 1; }
  .gear:hover { color: var(--accent); border-color: var(--border-accent); }
  .prompt { font-size: 13px; }
  .cellbar { display: flex; justify-content: space-between; align-items: center; }
  .tag { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-pill); color: var(--accent); font-size: 12px; padding: 2px 8px; cursor: pointer; }
  .x { background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; }
  .x:hover { color: var(--err); }
  .empty { width: 100%; background: none; border: none; color: var(--text-3); cursor: pointer; font: inherit;
    padding: 16px; border-radius: var(--r-control); }
  .empty:hover { background: var(--cell-hover); color: var(--text-accent); }
  .nocat { width: 100%; align-self: center; color: var(--text-4); font-size: 12px; padding: 16px; }
</style>
