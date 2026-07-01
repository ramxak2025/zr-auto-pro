/**
 * Normalize a phone number to canonical format: +7XXXXXXXXXX
 * Handles both raw digits and formatted strings like +7 (999) 123-45-67.
 * Converts leading 8 to 7 for Russian numbers.
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
 * Core national key for format-agnostic phone matching / dedup.
 *
 * MUST stay byte-for-byte equivalent to `phoneSearchKey` in
 * shared/validation/phone.ts — the backend can't import the shared package
 * (it's outside this tsconfig rootDir), so we mirror it here, exactly like
 * normalizePhone above mirrors the shared normalizePhone.
 *
 * Strip every non-digit, keep the last 10 digits → drops a leading country
 * code (7 / 8 / +7). «+7 (988) 444-44-85», «89884444485», «79884444485» and
 * «9884444485» all collapse to «9884444485».
 *
 * The SQL equivalent (used in queries + the functional indexes in migration
 * 104) is:  right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
 *
 * Returns '' when the input has no digits (e.g. the pinned retail client) —
 * callers must treat '' as "no key" and never match / dedup on it.
 */
export function phoneSearchKey(phone: string): string {
  let digits = '';
  for (const c of phone || '') {
    if (c >= '0' && c <= '9') digits += c;
  }
  return digits.length > 10 ? digits.slice(-10) : digits;
}
