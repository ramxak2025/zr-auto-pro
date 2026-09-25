import type { KnowledgeBlock, KnowledgeCategory } from '../../types';

/** Русское склонение: pluralRu(3, 'материал', 'материала', 'материалов') → «материала». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «просмотр / просмотра / просмотров». */
export function pluralizeViews(n: number): string {
  return pluralRu(n, 'просмотр', 'просмотра', 'просмотров');
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(kb / 1024)} МБ`;
}

/** Человеческое сообщение из axios-ошибки (NestJS-валидация может вернуть string[]). */
export function errMessage(err: unknown, fallback: string): string {
  const m = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(m)) return m.filter(Boolean).join(', ') || fallback;
  return m || fallback;
}

export type FlatCategory = KnowledgeCategory & { depth: number };

/** Дерево папок → плоский список в глубину с уровнем вложенности (для select-ов и списка папок). */
export function flattenCategories(categories: KnowledgeCategory[]): FlatCategory[] {
  const childrenByParent = new Map<string | null, KnowledgeCategory[]>();
  for (const c of categories) {
    const p = c.parentId ?? null;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(c);
  }
  for (const list of childrenByParent.values())
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));

  const out: FlatCategory[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of childrenByParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // защита от циклов в повреждённых данных
      seen.add(c.id);
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Сироты без родителя в наборе (не должно случаться) — в корень.
  for (const c of categories) if (!seen.has(c.id)) out.push({ ...c, depth: 0 });
  return out;
}

/** Подпись папки в select-е: отступ по глубине неразрывными пробелами. */
export function indentedName(c: FlatCategory): string {
  return `${'  '.repeat(c.depth)}${c.name}`;
}

/** Пустые/пробельные блоки не отправляем — иначе полузаполненный блок валит валидацию. */
export function sanitizeBlocks(blocks: KnowledgeBlock[]): KnowledgeBlock[] {
  return blocks.filter((b) => {
    if (b.type === 'text' || b.type === 'heading') return b.text.trim().length > 0;
    if (b.type === 'image') return b.url.trim().length > 0;
    if (b.type === 'video') return b.url.trim().length > 0;
    return false;
  });
}
