import type { GameTemplate } from './templateTypes.js';
import type { BankView } from '../persistence/templateRepo.js';

export interface MediaCopy { from: string; to: string }

export function flattenTemplate(doc: GameTemplate, bank: BankView): { game: unknown; mediaCopies: MediaCopy[] } {
  const mediaCopies: MediaCopy[] = [];
  const seenMedia = new Set<string>();

  const rounds = doc.rounds.map(r => {
    const valueByColumn = new Map(r.columns.map(c => [c.id, c.value]));
    const categories = r.rows.map(row => {
      if (!row.categoryId) throw new Error('строка без категории');
      const cat = bank.categories.get(row.categoryId);
      if (!cat) throw new Error(`категория не найдена: ${row.categoryId}`);
      const questions = row.cells
        .map(cell => {
          if (!cell.questionId) throw new Error('пустая ячейка');
          const q = bank.questions.get(cell.questionId);
          if (!q) throw new Error(`вопрос не найден: ${cell.questionId}`);
          const value = valueByColumn.get(cell.columnId);
          if (value === undefined) throw new Error(`столбец не найден: ${cell.columnId}`);
          let media: string | undefined;
          if (q.media) {
            media = q.media.replace(/^bank\/media\//, 'media/');
            if (!seenMedia.has(q.media)) { seenMedia.add(q.media); mediaCopies.push({ from: q.media, to: media }); }
          }
          return { type: q.type, prompt: q.prompt, answer: q.answer, value, special: cell.special, ...(media ? { media } : {}) };
        })
        .sort((a, b) => a.value - b.value);
      return { name: cat.name, questions };
    });
    return { name: r.name, categories };
  });

  return { game: { title: doc.title, rounds }, mediaCopies };
}
