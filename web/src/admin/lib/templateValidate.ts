import type { GameTemplate, Problem } from './templateTypes.js';

export interface BankClientView { categories: Set<string>; questionCategory: Map<string, string> }

export function validateClient(doc: GameTemplate, bank: BankClientView): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!doc.title.trim()) errors.push({ kind: 'no-title' });
  const uses = new Map<string, number>();
  for (const r of doc.rounds) {
    if (!r.name.trim()) errors.push({ kind: 'round-no-name', roundId: r.id });
    if (r.columns.length === 0) errors.push({ kind: 'round-no-columns', roundId: r.id });
    if (r.rows.length === 0) errors.push({ kind: 'round-no-rows', roundId: r.id });
    for (const col of r.columns) if (!Number.isInteger(col.value) || col.value <= 0 || col.value % 100 !== 0) errors.push({ kind: 'bad-value', roundId: r.id, columnId: col.id });
    const seen = new Set<number>();
    for (const col of r.columns) { if (seen.has(col.value)) warnings.push({ kind: 'dup-value', roundId: r.id, value: col.value }); seen.add(col.value); }
    for (const row of r.rows) {
      if (!row.categoryId) errors.push({ kind: 'row-no-category', roundId: r.id, rowId: row.id });
      else if (!bank.categories.has(row.categoryId)) errors.push({ kind: 'row-bad-category', roundId: r.id, rowId: row.id });
      for (const cell of row.cells) {
        if (!cell.questionId) { errors.push({ kind: 'cell-empty', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        uses.set(cell.questionId, (uses.get(cell.questionId) ?? 0) + 1);
        const cat = bank.questionCategory.get(cell.questionId);
        if (cat === undefined) errors.push({ kind: 'cell-bad-question', roundId: r.id, rowId: row.id, columnId: cell.columnId });
        else if (row.categoryId && cat !== row.categoryId) errors.push({ kind: 'cell-wrong-category', roundId: r.id, rowId: row.id, columnId: cell.columnId });
      }
    }
  }
  for (const [questionId, c] of uses) if (c > 1) warnings.push({ kind: 'dup-question', questionId });
  return { errors, warnings };
}

export function summarize(errors: Problem[]): { rowsNoCategory: number; emptyCells: number } {
  return {
    rowsNoCategory: errors.filter(e => e.kind === 'row-no-category').length,
    emptyCells: errors.filter(e => e.kind === 'cell-empty').length,
  };
}
