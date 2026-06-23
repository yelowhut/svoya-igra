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

export interface TemplateRound {
  id: string;
  name: string;
  columns: TemplateColumn[];
  rows: TemplateRow[];
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
  | { kind: 'dup-value'; roundId: string; value: number }
  | { kind: 'dup-question'; questionId: string };
