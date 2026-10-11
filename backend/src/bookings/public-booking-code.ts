import { randomBytes } from 'crypto';

// React Router matches fixed paths without case sensitivity. Keep this list
// aligned with fixed first segments in App.tsx that match the alias shape;
// reserve a new matching application route before adding it to the router.
const reservedBookingCodes = new Set(['company-settings']);
export function isPublicBookingCode(code: string): boolean {
  return /^(?:[A-Za-z0-9_-]{16}|[a-f0-9]{32})$/.test(code) && !reservedBookingCodes.has(code.toLowerCase());
}
export function generatePublicBookingCode(): string {
  let code: string;
  do {
    code = randomBytes(12).toString('base64url');
  } while (!isPublicBookingCode(code));
  return code;
}
