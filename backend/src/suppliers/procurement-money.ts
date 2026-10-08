import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

// Migration 120: quantities are NUMERIC(12,3), money NUMERIC(12,2).
// Integer arithmetic throughout: no floating epsilon or implicit DB rounding.
export function scaled(value: unknown, places: number, label: string): bigint {
  const text = String(value ?? '');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2]?.length ?? 0) > places) {
    throw new BadRequestException({ message: `${label}: допустимо не более ${places} знаков после запятой` });
  }
  const result = BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] ?? '').padEnd(places, '0'));
  if (result > 999999999999n) throw new BadRequestException({ message: `${label}: слишком большое значение` });
  return result;
}

export const cents = (value: unknown) => scaled(value, 2, 'Цена');
export const quantityUnits = (value: unknown) => scaled(value, 3, 'Количество');
/** Inventory can legitimately be negative; incoming/requested quantities cannot. */
export function stockUnits(value: unknown): bigint {
  const text = String(value ?? '');
  return text.startsWith('-') ? -scaled(text.slice(1), 3, 'Остаток') : scaled(text, 3, 'Остаток');
}
export function positiveQuantity(value: unknown): bigint {
  const units = quantityUnits(value);
  if (units === 0n) throw new BadRequestException({ message: 'Количество должно быть положительным' });
  return units;
}
export const decimal = (value: bigint, places: number): string => {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(places + 1, '0');
  return `${sign}${digits.slice(0, -places)}.${digits.slice(-places)}`;
};
export const moneyNumber = (value: bigint) => Number(decimal(value, 2));
export const quantityNumber = (value: bigint) => Number(decimal(value, 3));
export const roundRatio = (numerator: bigint, denominator: bigint): bigint =>
  (numerator * 2n + denominator) / (denominator * 2n);
export const lineCents = (quantity: unknown, price: unknown) =>
  roundRatio(positiveQuantity(quantity) * cents(price), 1000n);

export interface AllocationLine {
  id: string;
  quantity: string | number;
  price: string | number;
  total: string | number;
}

/** Preserve existing line amounts when balanced; otherwise allocate the ORIGINAL
 * invoice cents by largest remainder, with stable source-line IDs as tie-breaker.
 * No historical rows or supplier balances are rewritten. */
export function allocateInvoiceCents(total: unknown, lines: AllocationLine[]): Map<string, bigint> {
  const header = cents(total);
  const original = new Map(lines.map((line) => [line.id, cents(line.total)]));
  if ([...original.values()].reduce((a, b) => a + b, 0n) === header) return original;
  const weights = lines.map((line) => ({ id: line.id, weight: positiveQuantity(line.quantity) * cents(line.price) }));
  const sum = weights.reduce((a, b) => a + b.weight, 0n);
  if (sum === 0n) throw new BadRequestException({ message: 'Сумма исходной накладной не соответствует её позициям' });
  const allocations = weights.map(({ id, weight }) => ({
    id,
    amount: (header * weight) / sum,
    remainder: (header * weight) % sum,
  }));
  let residual = header - allocations.reduce((a, b) => a + b.amount, 0n);
  allocations.sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  );
  for (const line of allocations) {
    if (residual === 0n) break;
    line.amount += 1n;
    residual -= 1n;
  }
  return new Map(allocations.map(({ id, amount }) => [id, amount]));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export async function replayProcurementRequest(
  client: PoolClient,
  tenantID: string,
  requestId: string | undefined,
  operation: string,
  payload: unknown,
): Promise<{ fingerprint: string; replay?: unknown }> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonical({ operation, payload })))
    .digest('hex');
  if (!requestId) return { fingerprint };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new BadRequestException({ message: 'Некорректный идентификатор запроса' });
  }
  // Taken BEFORE document/product locks. Commit stores the response atomically
  // with movements; a failed transaction leaves no poisoned idempotency key.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `procurement:${tenantID}:${requestId.toLowerCase()}`,
  ]);
  const { rows } = await client.query(
    'SELECT fingerprint, response FROM procurement_requests WHERE tenant_id=$1 AND request_id=$2',
    [tenantID, requestId],
  );
  if (rows.length && rows[0].fingerprint !== fingerprint) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Этот идентификатор запроса уже использован с другими данными',
    });
  }
  return rows.length ? { fingerprint, replay: rows[0].response } : { fingerprint };
}

export async function saveProcurementRequest(
  client: PoolClient,
  tenantID: string,
  requestId: string | undefined,
  fingerprint: string,
  response: unknown,
): Promise<void> {
  if (!requestId) return;
  await client.query(
    'INSERT INTO procurement_requests (tenant_id, request_id, fingerprint, response) VALUES ($1,$2,$3,$4::jsonb)',
    [tenantID, requestId, fingerprint, JSON.stringify(response)],
  );
}
