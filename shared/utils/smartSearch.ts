/** Pure catalog search shared by UI filters and server query preparation. */
export type SearchValue = string | number | null | undefined;
/** Lower is better; null means that at least one query token is missing. */
export type SearchRank = 0 | 1 | 2;

export function normalizeSearchText(value: SearchValue): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function searchTokens(query: SearchValue): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? [...new Set(normalized.split(' '))] : [];
}

const compact = (value: string) => value.replace(/ /g, '');

export function rankSearch(query: SearchValue, fields: readonly SearchValue[]): SearchRank | null {
  const text = normalizeSearchText(query);
  if (!text) return 2;
  const values = fields.map(normalizeSearchText).filter(Boolean);
  const key = compact(text);
  if (values.some((value) => value === text || compact(value) === key)) return 0;
  if (values.some((value) => value.startsWith(text) || compact(value).startsWith(key))) return 1;
  return searchTokens(text).every((token) =>
    values.some((value) => value.includes(token) || compact(value).includes(token)),
  )
    ? 2
    : null;
}

export function matchSearch(query: SearchValue, fields: readonly SearchValue[]): boolean {
  return rankSearch(query, fields) !== null;
}

const EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const RU_KEYS = 'ёйцукенгшщзхъфывапролджэячсмитьбю';

function keyboardVariant(query: string, from: string, to: string, alphabet: RegExp): string {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      const normalized = normalizeSearchText(word);
      // Never reinterpret numbers, barcodes or mixed numeric SKU tokens.
      if (/\d/.test(word) || normalized.replace(/ /g, '').length < 3 || !alphabet.test(normalized)) return word;
      return [...word]
        .map((letter) => {
          const index = from.indexOf(letter);
          return index < 0 ? letter : to[index];
        })
        .join('');
    })
    .join(' ');
}

/** Normalized original first, then deduplicated RU/EN keyboard alternatives.
 * Callers must try alternatives only after the original query returned no rows.
 */
export function getSearchQueryVariants(query: SearchValue): string[] {
  const raw = String(query ?? '');
  return [
    ...new Set([
      normalizeSearchText(raw),
      normalizeSearchText(keyboardVariant(raw, EN_KEYS, RU_KEYS, /^[a-z ]+$/)),
      normalizeSearchText(keyboardVariant(raw, RU_KEYS, EN_KEYS, /^[а-яе ]+$/)),
    ]),
  ];
}

/** Bounded Damerau distance <= 1: insertion, deletion, substitution or adjacent swap. */
function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1 || left.length > 64 || right.length > 64) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index++;
  if (index === left.length && index === right.length) return true;
  if (left.length < right.length) return left.slice(index) === right.slice(index + 1);
  if (left.length > right.length) return left.slice(index + 1) === right.slice(index);
  if (left.slice(index + 1) === right.slice(index + 1)) return true;
  return (
    left[index] === right[index + 1] &&
    left[index + 1] === right[index] &&
    left.slice(index + 2) === right.slice(index + 2)
  );
}

export interface SmartSearchOptions {
  /** Keyboard recovery is a fallback after all ordinary matches; enabled by default. */
  keyboardLayout?: boolean;
  /** Explicit opt-in; alphabetic tokens of 4–64 characters only. */
  typos?: boolean;
}

/** Stable ranking of existing objects only. A result still needs an explicit user selection. */
export function smartSearch<T>(
  items: readonly T[],
  query: SearchValue,
  fields: (item: T) => readonly SearchValue[],
  options: SmartSearchOptions = {},
): T[] {
  const variants = options.keyboardLayout === false ? [normalizeSearchText(query)] : getSearchQueryVariants(query);
  for (const variant of variants) {
    const ranked = items
      .map((item, index) => ({ item, index, rank: rankSearch(variant, fields(item)) }))
      .filter((entry): entry is { item: T; index: number; rank: SearchRank } => entry.rank !== null);
    if (ranked.length) return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.item);
  }
  if (!options.typos) return [];
  for (const variant of variants) {
    const tokens = searchTokens(variant);
    // A punctuated SKU (ABCD-123) splits into words during normalization.
    // Keep its alphabetic segment exact too: never typo-correct numeric queries.
    if (!tokens.length || tokens.length > 8 || /\p{N}/u.test(variant)) continue;
    const matches = items.filter((item) => {
      const values = fields(item).map(normalizeSearchText).filter(Boolean);
      const words = values.flatMap((value) => value.split(' '));
      return tokens.every(
        (token) =>
          values.some((value) => value.includes(token) || compact(value).includes(token)) ||
          (/^\p{L}{4,64}$/u.test(token) && words.some((word) => /^\p{L}+$/u.test(word) && oneEditApart(token, word))),
      );
    });
    if (matches.length) return matches;
  }
  return [];
}
