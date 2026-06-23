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

export function makeDefaultTemplate(
  opts: { template?: '5x5'; title?: string } = {},
  idGen: () => string = () => crypto.randomUUID(),
): GameTemplate {
  const round: TemplateRound = {
    id: idGen(),
    name: 'Раунд 1',
    columns: [],
    rows: [],
  };

  if (opts.template === '5x5') {
    round.columns = [100, 200, 300, 400, 500].map(value => ({
      id: idGen(),
      value,
    }));
    round.rows = Array.from({ length: 5 }, () => ({
      id: idGen(),
      categoryId: null,
      cells: round.columns.map(col => ({
        columnId: col.id,
        questionId: null,
        special: 'none' as const,
      })),
    }));
  }

  return {
    id: idGen(),
    title: opts.title ?? 'Новая игра',
    rounds: [round],
  };
}
