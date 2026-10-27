import type { Pool } from 'pg';

/** One tenant-bound aggregate per selected page; snapshots repeat per recipient. */
export async function checkMotivationAmounts(
  pool: Pool,
  tenantId: string,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{ check_id: string; amount: string }>(
    `SELECT check_id, COALESCE(SUM(amount), 0) AS amount
       FROM motivation_accruals WHERE tenant_id=$1 AND check_id=ANY($2::uuid[])
       GROUP BY check_id`,
    [tenantId, ids],
  );
  return new Map(rows.map((row) => [row.check_id, Number(row.amount)]));
}
