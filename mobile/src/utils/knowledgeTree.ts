/**
 * knowledgeTree — pure helpers to turn the flat `listCategories` array into a
 * navigable folder tree using `parentId` (079 contract).
 *
 * Contract reminder:
 *   • `parentId` absent/null  → a root-level folder.
 *   • Deleting a parent orphans its children to the root (ON DELETE SET NULL),
 *     so a `parentId` that points at a missing category is treated as root —
 *     children never silently disappear.
 *   • The server rejects cycles, but we still cap ancestor walks defensively.
 *
 * Dependency-free, side-effect-free, Android-safe.
 */
import type { KnowledgeCategory } from '../../../shared/types';

const bySortThenName = (a: KnowledgeCategory, b: KnowledgeCategory): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');

/** Top-level folders: no `parentId`, or a `parentId` that no longer exists. */
export function rootCategories(categories: KnowledgeCategory[]): KnowledgeCategory[] {
  const ids = new Set(categories.map((c) => c.id));
  return categories.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(bySortThenName);
}

/** Direct subfolders of `parentId`, ordered. */
export function childCategories(categories: KnowledgeCategory[], parentId: string): KnowledgeCategory[] {
  return categories.filter((c) => c.parentId === parentId).sort(bySortThenName);
}

/**
 * Ancestor trail for a category, ordered root → … → parent (the category itself
 * is NOT included). Drives the breadcrumb. Cap the walk to guard against any
 * malformed cycle that slipped past the server.
 */
export function categoryAncestors(categories: KnowledgeCategory[], id: string): KnowledgeCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const trail: KnowledgeCategory[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id);
  let guard = 0;
  while (current?.parentId && guard < 64) {
    guard += 1;
    const parent = byId.get(current.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}
