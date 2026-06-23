<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import type { TemplateRound, TemplateRow, TemplateCell } from '../../lib/templateTypes.js';
  import { drag } from './SourceSidebar.svelte';
  import { bankMediaUrl } from '../../bankApi.js';
  export let round: TemplateRound;
  export let categoryName: (id: string | null) => string = (id) => id ?? '';
  export let questionInfo: (id: string) => { type: string; prompt: string; media: string | null } | undefined = () => undefined;
  const dispatch = createEventDispatcher<{ change: void }>();
  const uid = () => crypto.randomUUID();
  const changed = () => { round = round; dispatch('change'); };

  const TAGS = ['none', 'cat', 'auction'] as const;
  function cycleTag(cell: TemplateCell) {
    if (!cell.questionId) return;
    cell.special = TAGS[(TAGS.indexOf(cell.special) + 1) % TAGS.length];
    changed();
  }
  function clearCell(row: TemplateRow, cell: TemplateCell) {
    cell.questionId = null; cell.special = 'none'; changed();
  }
  const tagLabel = (s: string) => s === 'cat' ? 'Кот' : s === 'auction' ? 'Аукцион' : '';

  let hover: { rowId: string; columnId: string; ok: boolean } | null = null;

  function dropCategory(row: TemplateRow) {
    const d = get(drag);
    if (d?.kind !== 'category') return;
    row.categoryId = d.id;
    row.cells = row.cells.map(c => ({ ...c, questionId: null, special: 'none' as const }));
    changed();
  }
  function overCell(row: TemplateRow, columnId: string) {
    const d = get(drag);
    if (d?.kind !== 'question') { hover = null; return; }
    hover = { rowId: row.id, columnId, ok: d.categoryId === row.categoryId };
  }
  function dropCell(row: TemplateRow, columnId: string) {
    const d = get(drag);
    if (d?.kind !== 'question' || d.categoryId !== row.categoryId) { hover = null; return; }
    const cell = row.cells.find(c => c.columnId === columnId);
    if (cell) cell.questionId = d.id;
    hover = null; changed();
  }

  function addColumn() {
    const max = round.columns.reduce((m, c) => Math.max(m, c.value), 0);
    const col = { id: uid(), value: max + 100 || 100 };
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
        {#if row.categoryId}<span>{categoryName(row.categoryId)}</span>{:else}<span class="dashed">Перетащите категорию</span>{/if}
        <button class="mini" title="Убрать строку" on:click={() => removeRow(row.id)}>−</button>
      </div>
      {#each row.cells as cell (cell.columnId)}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="cell"
          class:ok={hover?.rowId === row.id && hover?.columnId === cell.columnId && hover?.ok}
          class:bad={hover?.rowId === row.id && hover?.columnId === cell.columnId && !hover?.ok}
          on:dragover|preventDefault={() => overCell(row, cell.columnId)}
          on:dragleave={() => (hover = null)}
          on:drop|preventDefault={() => dropCell(row, cell.columnId)}>
          {#if cell.questionId}
            {@const info = questionInfo(cell.questionId)}
            <div class="filled">
              {#if info?.type === 'image' && info.media}<img src={bankMediaUrl(info.media)} alt="" />
              {:else if info?.type === 'audio' && info.media}<audio controls src={bankMediaUrl(info.media)}></audio>
              {:else}<span class="prompt">{info?.prompt?.slice(0, 40) ?? '—'}</span>{/if}
              <div class="cellbar">
                <button class="tag" on:click={() => cycleTag(cell)}>{tagLabel(cell.special) || 'тег'}</button>
                <button class="x" title="Очистить" on:click={() => clearCell(row, cell)}>×</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
      <div></div>
    </div>
  {/each}

  <button class="addrow" on:click={addRow}>+ Строка</button>
</div>

<style>
  .grid { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: center; }
  .corner, .cat { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .03em;
    background: var(--grad-rowlabel); border: 1px solid var(--border); border-radius: var(--r-control);
    padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .dashed { color: var(--text-3); font-size: 13px; }
  .colhead { display: flex; gap: 4px; align-items: center; }
  .price { width: 100%; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--gold); font-family: var(--font-display); font-size: 20px; font-weight: 700; text-align: center; padding: 8px; }
  .cell { padding: 16px; background: var(--cell); border: 1px solid var(--border); border-radius: var(--r-control);
    min-height: 48px; color: var(--text-2); text-align: center; }
  .cell.ok { border-color: var(--ok); box-shadow: 0 0 0 2px var(--ok); }
  .cell.bad { border-color: var(--err); box-shadow: 0 0 0 2px var(--err); }
  .mini { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 18px; }
  .mini:hover { background: var(--cell-hover); }
  .addrow { justify-self: start; background: var(--surface); border: 1px dashed var(--border);
    border-radius: var(--r-control); color: var(--text); padding: 10px 16px; cursor: pointer; }
  .filled { display: grid; gap: 6px; }
  .filled img { max-width: 100%; max-height: 64px; border-radius: 6px; }
  .cellbar { display: flex; justify-content: space-between; }
  .tag { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-pill); color: var(--accent); font-size: 12px; padding: 2px 8px; cursor: pointer; }
  .x { background: none; border: none; color: var(--text-2); cursor: pointer; font-size: 16px; }
  .x:hover { color: var(--err); }
</style>
