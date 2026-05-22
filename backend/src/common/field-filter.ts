// ── Optional field projection for list endpoints ─────────────────────────
// FE passes `?fields=id,name,stock` (comma list) to receive only the listed
// keys per item. Unknown keys are silently dropped (caller can safely retry
// older shapes after a server upgrade). Pass `?fields=*` (or no fields query)
// to receive the full object — matches the legacy behaviour.
//
// Use only on list endpoints. Detail endpoints intentionally always return
// the whole object so downstream code can rely on a complete shape.

export type FieldSet = Set<string> | null;

/**
 * Parse the `fields` query parameter into a Set (or `null` for "all fields").
 * Empty / "*" / undefined → null.
 */
export function parseFields(raw: unknown): FieldSet {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str || str === '*') return null;
  const set = new Set<string>();
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    if (trimmed) set.add(trimmed);
  }
  return set.size > 0 ? set : null;
}

/**
 * Project `obj` down to the requested keys. Returns `obj` unchanged when
 * fields is `null` (caller asked for everything).
 */
export function filterShape<T extends Record<string, unknown>>(obj: T, fields: FieldSet): Partial<T> {
  if (!fields) return obj;
  // Always retain id so list rows are addressable. Otherwise pagination
  // becomes useless on slim payloads.
  fields.add('id');
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  }
  return out as Partial<T>;
}
