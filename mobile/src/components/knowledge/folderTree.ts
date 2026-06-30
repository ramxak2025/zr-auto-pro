/**
 * folderTree — shared helpers for the Knowledge Base folder pickers
 * (create / move). Builds a depth-first, indented flattening of the category
 * tree (079 `parentId` contract) so a nested folder is one tap away.
 *
 * When MOVING a folder, the folder itself AND its descendants must be excluded
 * from the target list — a folder can't be re-parented under its own subtree
 * (the server rejects such a cycle with a 400; we also hide the option so it's
 * never offered). Pass `excludeSubtreeId` for that.
 *
 * Pure, side-effect-free, Android-safe.
 */
import { rootCategories, childCategories } from '../../utils/knowledgeTree';
import type { KnowledgeCategory } from '../../../../shared/types';

export interface FlatFolder {
  cat: KnowledgeCategory;
  /** Indentation depth — 0 for root folders. */
  depth: number;
}

/**
 * Depth-first flatten of the whole tree with indentation depth. When
 * `excludeSubtreeId` is given, that folder and its descendants are skipped.
 */
export function flattenWithDepth(categories: KnowledgeCategory[], excludeSubtreeId?: string | null): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 64) return;
    const children = parentId === null ? rootCategories(categories) : childCategories(categories, parentId);
    for (const cat of children) {
      // Skip the moved folder's own subtree (skipping the node also skips its
      // descendants because we don't recurse into it).
      if (excludeSubtreeId && cat.id === excludeSubtreeId) continue;
      out.push({ cat, depth });
      walk(cat.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
