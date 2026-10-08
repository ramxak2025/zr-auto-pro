const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HTTPS_PREFIXES = [
  'https://autexa-cloud.ru/nfc/attendance',
  'https://autexa.pw/nfc/attendance',
] as const;
const APP_PREFIX = 'autexa://nfc/attendance';

/** Strictly accepts the two HTTPS tag origins and the one approved app fallback. */
export function parseAttendanceNfcUri(input: string): { token: string } | null {
  if (!input || input.includes('?') || (input.match(/#/g)?.length ?? 0) !== 1) return null;
  const hashAt = input.indexOf('#');
  const base = input.slice(0, hashAt);
  const fragment = input.slice(hashAt + 1);
  if (fragment.length === 0) return null;

  const allowedBase = HTTPS_PREFIXES.some((prefix) => base === prefix) || base === APP_PREFIX;
  if (!allowedBase) return null;

  const fields = fragment.split('&');
  if (fields.length !== 2) return null;
  const entries = fields.map((field) => {
    const separator = field.indexOf('=');
    if (separator <= 0 || separator !== field.lastIndexOf('=')) return null;
    return [field.slice(0, separator), field.slice(separator + 1)] as const;
  });
  if (entries.some((entry) => entry === null)) return null;
  const values = new Map(entries as ReadonlyArray<readonly [string, string]>);
  if (values.size !== 2 || values.get('v') !== '1') return null;
  const token = values.get('token');
  return token && TOKEN.test(token) ? { token } : null;
}
