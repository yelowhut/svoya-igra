export type SpecialTag = 'none' | 'auction' | 'cat';

export interface TemplateColumn {
  id: string;
  value: number;
}

export interface TemplateCell {
  columnId: string;
  questionId: string | null;
  special: SpecialTag;
}

export interface TemplateRow {
  id: string;
  categoryId: string | null;
  cells: TemplateCell[];
}

export interface TemplateNormalRound {
  id: string;
  type?: 'normal';
  name: string;
  columns: TemplateColumn[];
  rows: TemplateRow[];
}

export interface TemplateFinalTheme {
  id: string;
  name: string;
  questionId: string | null;
}

export interface TemplateFinalRound {
  id: string;
  type: 'final';
  name: string;
  themes: TemplateFinalTheme[];
}

export type TemplateRound = TemplateNormalRound | TemplateFinalRound;

export function isFinalRound(r: TemplateRound): r is TemplateFinalRound {
  return (r as TemplateFinalRound).type === 'final';
}

export function makeFinalRound(idGen: () => string): TemplateFinalRound {
  return {
    id: idGen(),
    type: 'final',
    name: 'Финал',
    themes: [
      { id: idGen(), name: 'Тема 1', questionId: null },
      { id: idGen(), name: 'Тема 2', questionId: null },
    ],
  };
}

export interface GameTemplate {
  id: string;
  title: string;
  lastPublishedPackId?: string;
  rounds: TemplateRound[];
}

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
