/** Booking-only mask. Existing saved request bodies are never passed through it. */
export function bookingPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && !value.trim().startsWith('+')) return digits;
  if (value.trim().startsWith('+') || digits.length > 10 || /^[78]/.test(digits)) return digits.slice(1, 11);
  return digits.slice(0, 10);
}
export function formatBookingPhone(value: string): string {
  const digits = bookingPhoneDigits(value);
  if (!digits) return value.replace(/\D/g, '') ? '+7 (' : '';
  let result = `+7 (${digits.slice(0, 3)}`;
  if (digits.length >= 3) result += ') ';
  if (digits.length > 3) result += digits.slice(3, 6);
  if (digits.length > 6) result += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) result += `-${digits.slice(8, 10)}`;
  return result;
}
export function normalizeBookingPhone(value: string): string | null {
  const digits = bookingPhoneDigits(value);
  return digits.length === 10 ? `+7${digits}` : null;
}
function digitIndex(value: string, position: number) {
  return Math.max(0, value.slice(0, position).replace(/\D/g, '').length - (value.startsWith('+7') ? 1 : 0));
}
export function bookingPhoneCaret(value: string, index: number): number {
  if (index >= bookingPhoneDigits(value).length) return value.length;
  let count = -1;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i])) count++;
    if (count === index && index > 0) return i + 1;
  }
  return Math.min(value.length, 4);
}
export function editBookingPhone(
  value: string,
  start: number,
  end: number,
  inserted: string,
  operation: 'insert' | 'backspace' | 'delete' = 'insert',
): { value: string; caret: number } {
  const insertedDigits = inserted.replace(/\D/g, '');
  // Pasting a complete Russian phone replaces the field, including an existing
  // country prefix or partially selected national number. Never concatenate it.
  if (
    operation === 'insert' &&
    (insertedDigits.length === 10 || (insertedDigits.length === 11 && /^[78]/.test(insertedDigits)))
  ) {
    const formatted = formatBookingPhone(inserted);
    return { value: formatted, caret: formatted.length };
  }
  const digits = bookingPhoneDigits(value);
  let from = digitIndex(value, start);
  let to = digitIndex(value, end);
  if (start === end && operation === 'backspace') from = Math.max(0, from - 1);
  if (start === end && operation === 'delete') to = Math.min(digits.length, to + 1);
  const replacement = start === 0 && end === value.length ? bookingPhoneDigits(inserted) : inserted.replace(/\D/g, '');
  const next = (digits.slice(0, from) + replacement + digits.slice(to)).slice(0, 10);
  const formatted = next ? formatBookingPhone(`+7${next}`) : '';
  return { value: formatted, caret: bookingPhoneCaret(formatted, Math.min(next.length, from + replacement.length)) };
}
export function formatBookingPhoneInput(value: string, caret: number) {
  const formatted = formatBookingPhone(value);
  const country =
    value.trim().startsWith('+') ||
    value.replace(/\D/g, '').length > 10 ||
    (value.replace(/\D/g, '').length < 10 && /^[78]/.test(value.replace(/\D/g, '')));
  const index = Math.max(0, value.slice(0, caret).replace(/\D/g, '').length - Number(country));
  return { value: formatted, caret: bookingPhoneCaret(formatted, index) };
}
