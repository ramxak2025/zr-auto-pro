/** Canonical form used by service visibility rules without rewriting catalog categories. */
export function normalizeServiceCategoryPath(value: string): string {
  return value.split('/').map((segment) => segment.trim()).filter(Boolean).join('/');
}
