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
