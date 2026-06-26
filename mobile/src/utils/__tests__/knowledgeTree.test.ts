/**
 * knowledgeTree tests — folder grouping for the Knowledge Base reader.
 *
 * The reader builds its folder/subfolder navigation entirely client-side from
 * the flat `listCategories` array, so this grouping is the backbone of the
 * Files/Notes-like drill-down. A regression here breaks folder navigation.
 */
import { rootCategories, childCategories, categoryAncestors } from '../knowledgeTree';
import type { KnowledgeCategory } from '../../../../shared/types';

const cat = (id: string, name: string, parentId?: string, sortOrder = 0): KnowledgeCategory => ({
  id,
  name,
  sortOrder,
  ...(parentId ? { parentId } : {}),
});

// root «А» → child «Б» → grandchild «В»; plus root «Я»; plus an orphan whose
// parent doesn't exist (must surface at root, never vanish).
const cats: KnowledgeCategory[] = [
  cat('a', 'А-папка', undefined, 0),
  cat('b', 'Б-подпапка', 'a', 0),
  cat('c', 'В-вложенная', 'b', 0),
  cat('z', 'Я-папка', undefined, 5),
  cat('orphan', 'Сирота', 'missing-parent', 1),
];

describe('rootCategories', () => {
  it('returns only top-level folders, ordered by sortOrder then name', () => {
    const roots = rootCategories(cats).map((c) => c.id);
    expect(roots).toEqual(['a', 'orphan', 'z']);
  });

  it('treats a category pointing at a missing parent as root (orphan-to-root)', () => {
    expect(rootCategories(cats).some((c) => c.id === 'orphan')).toBe(true);
  });

  it('handles an empty list', () => {
    expect(rootCategories([])).toEqual([]);
  });
});

describe('childCategories', () => {
  it('returns direct children only', () => {
    expect(childCategories(cats, 'a').map((c) => c.id)).toEqual(['b']);
    expect(childCategories(cats, 'b').map((c) => c.id)).toEqual(['c']);
  });

  it('returns empty for a leaf folder', () => {
    expect(childCategories(cats, 'c')).toEqual([]);
  });
});

describe('categoryAncestors', () => {
  it('builds a root→parent trail excluding the node itself', () => {
    expect(categoryAncestors(cats, 'c').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('is empty for a root folder', () => {
    expect(categoryAncestors(cats, 'a')).toEqual([]);
  });

  it('does not loop forever on a malformed cycle', () => {
    const cyclic: KnowledgeCategory[] = [cat('x', 'X', 'y'), cat('y', 'Y', 'x')];
    expect(() => categoryAncestors(cyclic, 'x')).not.toThrow();
    expect(categoryAncestors(cyclic, 'x').length).toBeLessThanOrEqual(2);
  });
});
