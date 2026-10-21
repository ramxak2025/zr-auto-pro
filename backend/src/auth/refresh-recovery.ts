import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export const REFRESH_KEY_HEADER = 'x-refresh-request-id';

/** The UUID is a secret recovery capability, not a public correlation ID. */
export function refreshKeyHash(value: unknown): string | null {
  if (value === undefined) return null; // Compatibility: old clients rotate once, without replay.
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new BadRequestException({ message: 'Неверный ключ восстановления сессии' });
  }
  return createHash('sha256').update(value).digest('hex');
}

/** Used only by the refresh strategy. The service repeats this under a row lock. */
const RECEIPT_SQL = `
  r.refresh_key_hash = $2
  AND r.refresh_recover_until > now() AND r.expires_at > now()
  AND r.refresh_successor IS NOT NULL`;
export function recoverableSessionSql(operation: 'refresh' | 'switch-point' | 'logout'): string {
  if (operation === 'logout') return `${RECEIPT_SQL} AND r.revocation_reason IN ('refresh','switch-point')`;
  return `${RECEIPT_SQL} AND r.revocation_reason='${operation}'
    ${operation === 'switch-point' ? "AND r.refresh_successor->>'pointId'=$3" : ''}
    AND NOT EXISTS (SELECT 1 FROM revoked_tokens child WHERE child.jti = r.refresh_successor->>'jti')`;
}
