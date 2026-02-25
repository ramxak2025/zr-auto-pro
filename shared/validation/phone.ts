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
