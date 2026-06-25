import { z } from 'zod';
import type { GameTemplate } from './templateTypes.js';
import { isFinalRound } from './templateTypes.js';

export const PORTABLE_FORMAT = 'svoya-game-template@1';

const portableNormalRoundSchema = z.object({
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
});

const portableFinalRoundSchema = z.object({
  type: z.literal('final'),
  id: z.string(),
  name: z.string(),
  themes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    questionId: z.string().nullable(),
  })),
});

const portableRoundSchema = z.union([portableFinalRoundSchema, portableNormalRoundSchema]);

const portableSchema = z.object({
  format: z.literal(PORTABLE_FORMAT),
  title: z.string(),
  rounds: z.array(portableRoundSchema),
});

export type Portable = z.infer<typeof portableSchema>;

export function toPortable(doc: GameTemplate): Portable {
  return {
    format: PORTABLE_FORMAT,
    title: doc.title,
    rounds: doc.rounds.map(r => {
      if (isFinalRound(r)) {
        return {
          type: 'final' as const,
          id: r.id,
          name: r.name,
          themes: r.themes.map(t => ({
            id: t.id,
            name: t.name,
            questionId: t.questionId,
          })),
        };
      }
      return {
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
      };
    }),
  };
}

export function fromPortable(
  json: unknown,
  idGen: () => string = () => crypto.randomUUID(),
): GameTemplate {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const parsed = portableSchema.safeParse(data);
  if (!parsed.success) {
    const wrongFormat = (data as { format?: unknown } | null)?.format !== PORTABLE_FORMAT;
    throw new Error(wrongFormat
      ? 'Не похоже на файл шаблона игры (неверный формат)'
      : 'Структура файла шаблона повреждена');
  }
  const p = parsed.data;
  return { id: idGen(), title: p.title, rounds: p.rounds };
}
