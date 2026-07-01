/**
 * Format a raw phone string into Russian format: +7 (XXX) XXX-XX-XX
 * Converts leading 8 to 7.
 */
export function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 0 && digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

/**
 * Normalize a phone number to canonical format: +7XXXXXXXXXX
 */
export function normalizePhone(phone: string): string {
  let digits = '';
  for (const c of phone) {
    if (c >= '0' && c <= '9') digits += c;
  }
  if (digits.length === 11 && digits[0] === '8') {
    digits = '7' + digits.substring(1);
  }
  if (digits.length > 0) return '+' + digits;
  return phone;
}

/**
 * Check if a phone number has enough digits to be valid.
 */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10;
}

/**
 * Reduce a phone (in ANY format) to its core national key for matching:
 * strip every non-digit, then keep the last 10 digits — which drops a leading
 * country code (7 / 8 / +7) so that
 *   «+7 (988) 444-44-85», «89884444485», «79884444485» and «9884444485»
 * all collapse to the same key «9884444485».
 *
 * Use this to normalise BOTH the search query AND the stored value before
 * comparing, so a client is found / deduped regardless of how the phone was
 * typed or saved. The backend mirrors this exactly:
 *   - JS/TS:  raw.replace(/\D/g, '').slice(-10)
 *   - SQL:    right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
 * (see backend/src/common/normalize-phone.ts + migration 104).
 *
 * Returns '' for input without digits (e.g. the pinned retail client), which
 * callers treat as "no phone key" — never matched or deduped.
 */
export function phoneSearchKey(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(-10);
}

/**
 * Trunk-prefix-tolerant search variants of a phone QUERY (Round 7 #8, TASK C).
 *
 * Problem: `phoneSearchKey('8988') === '8988'` is NOT a substring of the
 * stored key `'9884444485'` — a typed leading trunk digit (8 / 7 / +7) breaks
 * `.includes` containment for PARTIAL queries. (`phoneSearchKey` only drops
 * the trunk once the number is complete, via `.slice(-10)`.)
 *
 * Returns every digit form the query could mean, ordered from "as typed"
 * to "most national":
 *   1. digits-only of the raw input;
 *   2. if it starts with '7' or '8' (incl. '+7 …' → digits '7…') and has ≥2
 *      digits — the same without the first (trunk) digit;
 *   3. the last-10 key (`phoneSearchKey` parity) — keeps every match the old
 *      single-key comparison produced, e.g. a double-prefixed paste
 *      «+7 8 988 444-44-85» still collapses to '9884444485'.
 * Deduped, empties dropped; '' / digit-less input → [].
 *
 * Usage contract:
 *   - display filters: match when ANY variant is contained in the stored key;
 *   - network `?search=`: send the LAST element (the most-national form) —
 *     any stored key containing a trunk-prefixed form also contains its
 *     national suffix, so the stripped variant is a SUPERSET fetch and the
 *     client-side variant filter narrows it afterwards.
 *
 * Examples:
 *   phoneSearchVariants('8988')     → ['8988', '988']
 *   phoneSearchVariants('+7 988')   → ['7988', '988']
 *   phoneSearchVariants('988')      → ['988']
 *   phoneSearchVariants('89884444485') → ['89884444485', '9884444485']
 */
export function phoneSearchVariants(raw: string): string[] {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return [];
  const candidates = [digits];
  if ((digits[0] === '7' || digits[0] === '8') && digits.length >= 2) {
    candidates.push(digits.slice(1));
  }
  candidates.push(digits.slice(-10));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of candidates) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
