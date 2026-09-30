import { formatPhone } from '../../../../shared/validation/phone';

/** Маска телефона при вводе: «9…» без кода страны получает «7», остальное — как formatPhone. */
export function maskPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return formatPhone(digits.startsWith('9') ? `7${digits}` : digits);
}
