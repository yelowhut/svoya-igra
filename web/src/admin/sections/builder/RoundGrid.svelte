<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TemplateRound, TemplateRow } from '../../lib/templateTypes.js';
  export let round: TemplateRound;
  const dispatch = createEventDispatcher<{ change: void }>();
  const uid = () => crypto.randomUUID();
  const changed = () => { round = round; dispatch('change'); };

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
      <div class="cat">
        {#if row.categoryId}<span>{row.categoryId}</span>{:else}<span class="dashed">Перетащите категорию</span>{/if}
        <button class="mini" title="Убрать строку" on:click={() => removeRow(row.id)}>−</button>
      </div>
      {#each row.cells as cell (cell.columnId)}
        <div class="cell">{cell.questionId ? '•' : ''}</div>
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
  .mini { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-control);
    color: var(--text); width: 2.2rem; height: 2.2rem; cursor: pointer; font-size: 18px; }
  .mini:hover { background: var(--cell-hover); }
  .addrow { justify-self: start; background: var(--surface); border: 1px dashed var(--border);
    border-radius: var(--r-control); color: var(--text); padding: 10px 16px; cursor: pointer; }
</style>
