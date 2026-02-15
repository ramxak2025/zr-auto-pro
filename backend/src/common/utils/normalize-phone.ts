/**
 * Normalizes any phone format to +7XXXXXXXXXX (11-digit with +).
 * Handles: "+7 (900) 123-45-67", "79001234567", "89001234567", "+79001234567", etc.
 * Returns the original string if it doesn't look like a valid Russian phone.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return phone;

  // Strip everything except digits
  let digits = phone.replace(/\D/g, '');

  // Handle leading 8 → convert to 7
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.slice(1);
  }

  // If 10 digits, prepend 7
  if (digits.length === 10) {
    digits = '7' + digits;
  }

  // Valid Russian mobile: 11 digits starting with 7
  if (digits.length === 11 && digits.startsWith('7')) {
    return '+' + digits;
  }

  // Can't normalize — return original trimmed
  return phone.trim();
}
