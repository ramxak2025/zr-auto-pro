import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export const NFC_OPEN_WINDOW_MS = 10 * 60_000;
export const NFC_CLOSE_DUPLICATE_MS = 10_000;
export function nfcTokenHash(token: string): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new BadRequestException({ message: 'Некорректная NFC-метка' });
  }
  return createHash('sha256').update(token).digest('hex');
}
export function nfcUri(token: string): string {
  nfcTokenHash(token);
  const origin = new URL(process.env.APP_URL || 'https://autexa-cloud.ru');
  if (
    origin.protocol !== 'https:' ||
    !['autexa-cloud.ru', 'autexa.pw'].includes(origin.hostname) ||
    origin.port ||
    origin.username ||
    origin.password
  )
    throw new Error('NFC requires a trusted HTTPS APP_URL');
  return `${origin.origin}/nfc/attendance#v=1&token=${token}`;
}
export type NfcAction = 'opened' | 'confirmed' | 'closed' | 'unchanged';
/** Clock is captured after the employee/shift locks. requestStartedAt is used
 * solely to recognize a duplicate NFC event, never as attendance time. */
export function nfcDecision(input: {
  now: Date;
  requestStartedAt: Date;
  hasOpenShift: boolean;
  firstNfcAt: Date | null;
  lastNfcClose: Date | null;
}): { action: NfcAction; reason: 'within_window' | 'closing_duplicate' | null } {
  const last = input.lastNfcClose?.getTime();
  const started = input.requestStartedAt.getTime();
  if (input.hasOpenShift) {
    if (!input.firstNfcAt) return { action: 'confirmed', reason: null };
    // A request predating this NFC event cannot close it after waiting for
    // locks, including ingress during the previous closing cooldown. A manual
    // opening above still gets its required first confirmation.
    if (started <= input.firstNfcAt.getTime() || (last !== undefined && started <= last)) {
      return { action: 'unchanged', reason: 'closing_duplicate' };
    }
    return input.now.getTime() - input.firstNfcAt.getTime() <= NFC_OPEN_WINDOW_MS
      ? { action: 'unchanged', reason: 'within_window' }
      : { action: 'closed', reason: null };
  }
  if (last !== undefined && (started <= last || input.now.getTime() - last <= NFC_CLOSE_DUPLICATE_MS)) {
    return { action: 'unchanged', reason: 'closing_duplicate' };
  }
  return { action: 'opened', reason: null };
}
