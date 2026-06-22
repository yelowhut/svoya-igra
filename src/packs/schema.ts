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
const roundSchema = z.object({ name: z.string().min(1), categories: z.array(categorySchema).min(1) });
export const gameJsonSchema = z.object({ title: z.string().min(1), rounds: z.array(roundSchema).min(1) });

export function parseGameJson(data: unknown, idGen: () => string = () => crypto.randomUUID()): Pack {
  const parsed = gameJsonSchema.parse(data);
  return {
    id: idGen(),
    title: parsed.title,
    rounds: parsed.rounds.map(r => ({
      id: idGen(), name: r.name,
      categories: r.categories.map(c => ({
        id: idGen(), name: c.name,
        questions: c.questions.map(q => ({ id: idGen(), ...q })),
      })),
    })),
  };
}
