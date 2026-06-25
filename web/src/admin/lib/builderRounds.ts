// Чистые хелперы конструктора игр: позиция вставки обычного раунда и расчёт занятых категорий.
import type { TemplateRound } from './templateTypes.js';
import { isFinalRound } from './templateTypes.js';

/**
 * Индекс, по которому должен вставляться НОВЫЙ обычный раунд: перед финал-раундом,
 * если он есть (финал всегда последний), иначе — в конец.
 */
export function insertIndexForNormalRound(rounds: TemplateRound[]): number {
  const fi = rounds.findIndex(isFinalRound);
  return fi >= 0 ? fi : rounds.length;
}

/**
 * Категории, уже занятые где-либо в шаблоне: в строках обычных раундов (по `row.categoryId`)
 * и неявно в финал-темах (по категории назначенного вопроса). Сквозь все раунды.
 */
export function computeUsedCategoryIds(
  rounds: TemplateRound[],
  questionCategory: Map<string, string>,
): Set<string> {
  const used = new Set<string>();
  for (const r of rounds) {
    if (isFinalRound(r)) {
      for (const th of r.themes) {
        if (th.questionId) {
          const cat = questionCategory.get(th.questionId);
          if (cat) used.add(cat);
        }
      }
    } else {
      for (const row of r.rows) {
        if (row.categoryId) used.add(row.categoryId);
      }
    }
  }
  return used;
}
