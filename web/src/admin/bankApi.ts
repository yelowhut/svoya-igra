export type QType = 'text' | 'image' | 'audio';
export interface Category { id: string; name: string; position: number; questionCount: number }
export interface Question { id: string; categoryId: string; type: QType; prompt: string; answer: string; media: string | null; position: number }

export const EXPORT_URL = '/api/bank/export';

export function bankMediaUrl(path: string): string {
  return '/media/bank/' + path.replace(/^bank\/media\//, '');
}

async function jsonOf(r: Response): Promise<any> {
  if (!r.ok) {
    const msg = await r.json().then(b => (b as { error?: string }).error).catch(() => undefined);
    throw new Error(msg ?? `HTTP ${r.status}`);
  }
  return r.json();
}
const jsonHeaders = { 'content-type': 'application/json' };

export const listCategories = (): Promise<Category[]> => fetch('/api/bank/categories').then(jsonOf);
export const createCategory = (name: string): Promise<{ id: string }> =>
  fetch('/api/bank/categories', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) }).then(jsonOf);
export const renameCategory = (id: string, name: string): Promise<unknown> =>
  fetch(`/api/bank/categories/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ name }) }).then(jsonOf);
export const reorderCategories = (orderedIds: string[]): Promise<unknown> =>
  fetch('/api/bank/categories/reorder', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ orderedIds }) }).then(jsonOf);
export const deleteCategory = (id: string): Promise<unknown> =>
  fetch(`/api/bank/categories/${id}`, { method: 'DELETE' }).then(jsonOf);

export const listQuestions = (categoryId: string): Promise<Question[]> =>
  fetch(`/api/bank/categories/${categoryId}/questions`).then(jsonOf);
export const createQuestion = (categoryId: string): Promise<{ id: string }> =>
  fetch(`/api/bank/categories/${categoryId}/questions`, { method: 'POST', headers: jsonHeaders, body: '{}' }).then(jsonOf);
export const updateQuestion = (id: string, fields: Partial<Pick<Question, 'type' | 'prompt' | 'answer' | 'media'>>): Promise<unknown> =>
  fetch(`/api/bank/questions/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(fields) }).then(jsonOf);
export const reorderQuestions = (categoryId: string, orderedIds: string[]): Promise<unknown> =>
  fetch(`/api/bank/categories/${categoryId}/questions/reorder`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ orderedIds }) }).then(jsonOf);
export const deleteQuestion = (id: string): Promise<unknown> =>
  fetch(`/api/bank/questions/${id}`, { method: 'DELETE' }).then(jsonOf);

export const uploadMedia = (id: string, file: File): Promise<{ path: string }> => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(`/api/bank/questions/${id}/media`, { method: 'POST', body: fd }).then(jsonOf);
};
export const importBank = (file: File): Promise<{ categories: number; questions: number }> => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch('/api/bank/import', { method: 'POST', body: fd }).then(jsonOf);
};
