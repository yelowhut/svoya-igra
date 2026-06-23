import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

export type Problem =
  | { kind: 'no-title' }
  | { kind: 'round-no-name'; roundId: string }
  | { kind: 'round-no-columns'; roundId: string }
  | { kind: 'round-no-rows'; roundId: string }
  | { kind: 'bad-value'; roundId: string; columnId: string }
  | { kind: 'row-no-category'; roundId: string; rowId: string }
  | { kind: 'row-bad-category'; roundId: string; rowId: string }
  | { kind: 'cell-empty'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-bad-question'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-wrong-category'; roundId: string; rowId: string; columnId: string }
  | { kind: 'cell-missing-media'; roundId: string; rowId: string; columnId: string }
  | { kind: 'dup-value'; roundId: string; value: number }
  | { kind: 'dup-question'; questionId: string };

export function validateForPublish(
  doc: GameTemplate,
  bank: BankView,
  mediaExists: (relPath: string) => boolean,
): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  if (!doc.title.trim()) errors.push({ kind: 'no-title' });
  if (doc.rounds.length === 0) return { errors, warnings };

  const questionUses = new Map<string, number>();

  for (const r of doc.rounds) {
    if (!r.name.trim()) errors.push({ kind: 'round-no-name', roundId: r.id });
    if (r.columns.length === 0) errors.push({ kind: 'round-no-columns', roundId: r.id });
    if (r.rows.length === 0) errors.push({ kind: 'round-no-rows', roundId: r.id });

    for (const col of r.columns) {
      if (!Number.isInteger(col.value) || col.value <= 0 || col.value % 100 !== 0) errors.push({ kind: 'bad-value', roundId: r.id, columnId: col.id });
    }
    const seenValues = new Set<number>();
    for (const col of r.columns) {
      if (seenValues.has(col.value)) warnings.push({ kind: 'dup-value', roundId: r.id, value: col.value });
      seenValues.add(col.value);
    }

    for (const row of r.rows) {
      if (!row.categoryId) { errors.push({ kind: 'row-no-category', roundId: r.id, rowId: row.id }); }
      else if (!bank.categories.has(row.categoryId)) { errors.push({ kind: 'row-bad-category', roundId: r.id, rowId: row.id }); }

      for (const cell of row.cells) {
        if (!cell.questionId) { errors.push({ kind: 'cell-empty', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        questionUses.set(cell.questionId, (questionUses.get(cell.questionId) ?? 0) + 1);
        const q = bank.questions.get(cell.questionId);
        if (!q) { errors.push({ kind: 'cell-bad-question', roundId: r.id, rowId: row.id, columnId: cell.columnId }); continue; }
        if (row.categoryId && q.categoryId !== row.categoryId) errors.push({ kind: 'cell-wrong-category', roundId: r.id, rowId: row.id, columnId: cell.columnId });
        if (q.type !== 'text' && (!q.media || !mediaExists(q.media))) errors.push({ kind: 'cell-missing-media', roundId: r.id, rowId: row.id, columnId: cell.columnId });
      }
    }
  }
  for (const [questionId, count] of questionUses) {
    if (count > 1) warnings.push({ kind: 'dup-question', questionId });
  }
  return { errors, warnings };
}
