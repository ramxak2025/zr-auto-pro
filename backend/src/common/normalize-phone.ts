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
