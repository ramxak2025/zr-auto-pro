import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';

// Standalone backend mirror of shared/utils/smartSearch.ts: Docker only copies backend.
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

export function prepareSearch(query: unknown): string[] {
  if (query === undefined || query === null || query === '') return [];
  if (typeof query !== 'string' || query.length > 256)
    throw new BadRequestException({ message: 'Поисковый запрос должен быть не длиннее 256 символов' });
  const variants = getSearchQueryVariants(query);
  if (
    variants.some(
      (variant) => searchTokens(variant).length > 8 || searchTokens(variant).some((token) => token.length > 64),
    )
  )
    throw new BadRequestException({ message: 'Сократите поисковый запрос: не больше 8 слов по 64 символа' });
  return variants[0] ? variants : [];
}

interface SearchPageOptions {
  /** Trusted SQL only. All tenant/point/role/category constraints MUST already be applied here. */
  select: string;
  from: string;
  where: string;
  fields: readonly string[];
  params: unknown[];
  query: unknown;
  order: string;
  limit: number;
  offset: number;
  /** Legacy exact phone/plate/VIN matches; evaluated only for the original query. */
  extraMatch?: string;
}

/** One statement/snapshot: full authorized dataset, fallback choice, count, then stable pagination. */
export async function searchPage(db: Pick<Pool, 'query'>, options: SearchPageOptions) {
  const { select, from, where, fields, order, limit, offset } = options;
  const params = [...options.params];
  const variants = prepareSearch(options.query);
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const variantParam = bind(variants);
  const limitParam = bind(limit);
  const offsetParam = bind(offset);
  // POSITION rather than LIKE makes % and _ literal and avoids wildcard injection.
  const fieldSql = variants.length
    ? `ARRAY[${fields.map((field) => `autexa_search_normalize(${field})`).join(',')}]`
    : 'ARRAY[]::text[]';
  const sql = `WITH scoped AS MATERIALIZED (
    SELECT ${select}, ${fieldSql} AS _search_fields,
           ${options.extraMatch || 'false'} AS _search_extra
      ${from} WHERE ${where}
  ), ordinary AS MATERIALIZED (
    SELECT scoped.*, variant.stage AS _search_stage,
           CASE WHEN variant.stage=1 AND _search_extra THEN coalesce(ranked.rank,2) ELSE ranked.rank END AS _search_rank
      FROM scoped CROSS JOIN unnest(${variantParam}::text[]) WITH ORDINALITY variant(query,stage)
      CROSS JOIN LATERAL (SELECT autexa_search_rank(variant.query,_search_fields) AS rank) ranked
     WHERE ranked.rank IS NOT NULL OR (variant.stage=1 AND _search_extra)
  ), chosen AS MATERIALIZED (
    SELECT * FROM ordinary WHERE _search_stage=(SELECT min(_search_stage) FROM ordinary)
    UNION ALL
    SELECT scoped.*, 100 + variant.stage AS _search_stage, 2 AS _search_rank
      FROM scoped CROSS JOIN unnest(${variantParam}::text[]) WITH ORDINALITY variant(query,stage)
     WHERE NOT EXISTS (SELECT 1 FROM ordinary)
       AND autexa_search_typo_matches(variant.query,_search_fields)
    UNION ALL
    SELECT scoped.*, 0::bigint AS _search_stage, 2 AS _search_rank FROM scoped
     WHERE cardinality(${variantParam}::text[])=0
  ), matched AS MATERIALIZED (
    SELECT * FROM chosen WHERE _search_stage=(SELECT min(_search_stage) FROM chosen)
  ), paged AS (
    SELECT * FROM matched ORDER BY _search_rank, ${order} LIMIT ${limitParam} OFFSET ${offsetParam}
  ) SELECT (SELECT count(*) FROM matched)::int AS total,
       COALESCE((SELECT jsonb_agg(to_jsonb(paged) - '_search_fields' - '_search_extra' - '_search_stage' - '_search_rank') FROM paged),'[]'::jsonb) AS data`;
  const { rows } = await db.query<{ total: number; data: Record<string, unknown>[] }>(sql, params);
  return { rows: rows[0].data, total: rows[0].total };
}
