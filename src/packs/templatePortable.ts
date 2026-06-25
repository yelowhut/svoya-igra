import { z } from 'zod';
import type { GameTemplate } from './templateTypes.js';
import { isFinalRound } from './templateTypes.js';

export const PORTABLE_FORMAT = 'svoya-game-template@1';

const portableSchema = z.object({
  format: z.literal(PORTABLE_FORMAT),
  title: z.string(),
  rounds: z.array(z.object({
    id: z.string(),
    name: z.string(),
    columns: z.array(z.object({ id: z.string(), value: z.number().int() })),
    rows: z.array(z.object({
      id: z.string(),
      categoryId: z.string().nullable(),
      cells: z.array(z.object({
        columnId: z.string(),
        questionId: z.string().nullable(),
        special: z.enum(['none', 'auction', 'cat']),
      })),
    })),
  })),
});

export type Portable = z.infer<typeof portableSchema>;

export function toPortable(doc: GameTemplate): Portable {
  return {
    format: PORTABLE_FORMAT,
    title: doc.title,
    rounds: doc.rounds.filter(r => !isFinalRound(r)).map(r => ({
      id: r.id,
      name: r.name,
      columns: r.columns.map(c => ({ id: c.id, value: c.value })),
      rows: r.rows.map(row => ({
        id: row.id,
        categoryId: row.categoryId,
        cells: row.cells.map(cell => ({
          columnId: cell.columnId,
          questionId: cell.questionId,
          special: cell.special,
        })),
      })),
    })),
  };
}

export function fromPortable(
  json: unknown,
  idGen: () => string = () => crypto.randomUUID(),
): GameTemplate {
  const parsed = portableSchema.safeParse(json);
  if (!parsed.success) {
    const wrongFormat = (json as { format?: unknown } | null)?.format !== PORTABLE_FORMAT;
    throw new Error(wrongFormat
      ? 'Не похоже на файл шаблона игры (неверный формат)'
      : 'Структура файла шаблона повреждена');
  }
  const p = parsed.data;
  return { id: idGen(), title: p.title, rounds: p.rounds };
}
