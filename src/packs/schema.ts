import { z } from 'zod';
import type { Pack } from '../domain/types.js';

const questionSchema = z.object({
  type: z.enum(['text', 'image', 'audio']),
  prompt: z.string().min(1),
  media: z.string().optional(),
  answer: z.string().min(1),
  value: z.number().int().nonnegative(),
  special: z.enum(['none', 'auction', 'cat']),
}).refine(q => q.type === 'text' || !!q.media, {
  message: 'media обязателен для type image/audio', path: ['media'],
});

const categorySchema = z.object({ name: z.string().min(1), questions: z.array(questionSchema).min(1) });

const finalQuestionSchema = z.object({
  type: z.enum(['text', 'image', 'audio']),
  prompt: z.string().min(1),
  media: z.string().optional(),
  answer: z.string().min(1),
}).refine(q => q.type === 'text' || !!q.media, { message: 'media обязателен для image/audio', path: ['media'] });

const finalThemeSchema = z.object({ name: z.string().min(1), question: finalQuestionSchema });
const finalRoundSchema = z.object({ type: z.literal('final'), name: z.string().min(1), themes: z.array(finalThemeSchema).min(2) });
const normalRoundSchema = z.object({ type: z.literal('normal').optional(), name: z.string().min(1), categories: z.array(categorySchema).min(1) });
const roundSchema = z.union([finalRoundSchema, normalRoundSchema]);
export const gameJsonSchema = z.object({ title: z.string().min(1), rounds: z.array(roundSchema).min(1) });

export function parseGameJson(data: unknown, idGen: () => string = () => crypto.randomUUID()): Pack {
  const parsed = gameJsonSchema.parse(data);
  return {
    id: idGen(),
    title: parsed.title,
    rounds: parsed.rounds.map(r => {
      if (r.type === 'final') {
        return {
          id: idGen(), type: 'final' as const, name: r.name,
          themes: r.themes.map(t => ({
            id: idGen(), name: t.name,
            question: {
              id: idGen(),
              type: t.question.type,
              prompt: t.question.prompt,
              media: t.question.media,
              answer: t.question.answer,
              value: 0,
              special: 'none' as const,
            },
          })),
        };
      }
      return {
        id: idGen(), name: r.name,
        categories: r.categories.map(c => ({
          id: idGen(), name: c.name,
          questions: c.questions.map(q => ({ id: idGen(), ...q })),
        })),
      };
    }),
  };
}
