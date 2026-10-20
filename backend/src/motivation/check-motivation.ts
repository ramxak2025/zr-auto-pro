import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { bonusShares, decimal, netProductBases, roundRatio, scaled } from './motivation-money';
import { digest, effectiveRule, lockMotivationRead, readRules, UUID } from './motivation-rules';

interface CheckState {
  id: string;
  discount: string;
  payment_method: string;
  motivation_v2_posted_at: Date | null;
  motivation_assignees_confirmed: boolean;
}
interface Line {
  id: string;
  product_id: string | null;
  quantity: string;
  total_sell: string;
  category: string | null;
  warehouse_id: string | null;
  name: string;
}
interface SavedLine {
  id: string;
  quantity: string;
  netCents: string;
  grossCents?: string;
  basketKey?: string;
}

interface ProductInput {
  id?: string;
  productId?: string | null;
  name?: string;
  sellPrice?: number;
  costPrice?: number;
  quantity?: number;
}

/** Keep proven saved identities. Never guess between ambiguous deleted catalog rows. */
export async function reconcileMotivationProductLines<T extends ProductInput>(
  client: PoolClient,
  tenant: string,
  checkId: string,
  inputs: T[],
): Promise<Array<T & { id: string }>> {
  const previous = (
    await client.query<{
      id: string;
      product_id: string | null;
      name: string;
      sell_price: string;
      cost_price: string;
      quantity: string;
    }>(
      `SELECT pl.id,pl.product_id,pl.name,pl.sell_price,pl.cost_price,pl.quantity FROM check_product_lines pl
     JOIN checks c ON c.id=pl.check_id WHERE c.tenant_id=$1 AND c.id=$2 ORDER BY pl.id`,
      [tenant, checkId],
    )
  ).rows;
  const saved = (
    await client.query<{ sale_lines: SavedLine[] }>(
      'SELECT sale_lines FROM check_motivation_snapshots WHERE tenant_id=$1 AND check_id=$2',
      [tenant, checkId],
    )
  ).rows;
  const historicalIds = new Set(saved.flatMap((s) => s.sale_lines.map((line) => line.id)));
  const historicNull = previous.filter((line) => line.product_id === null && historicalIds.has(line.id));
  const used = new Set<string>();
  const identified = inputs.map((input) => {
    if (input.id === undefined) return { ...input };
    if (!UUID.test(input.id) || !previous.some((line) => line.id === input.id) || used.has(input.id)) {
      throw new BadRequestException({ message: 'Строка товара не принадлежит этому заказ-наряду или указана дважды' });
    }
    used.add(input.id);
    return { ...input };
  });
  const tuple = (name: string, price: string | number, cost: string | number, qty: string | number) => {
    try {
      return JSON.stringify([name, String(scaled(price, 2)), String(scaled(cost, 2)), String(scaled(qty, 3))]);
    } catch {
      throw new ConflictException({
        message: 'Не удалось сопоставить старую строку товара. Обновите экран и приложение',
      });
    }
  };
  const oldKey = (row: (typeof historicNull)[number]) => tuple(row.name, row.sell_price, row.cost_price, row.quantity);
  const newKey = (row: T) => tuple(row.name || '', row.sellPrice || 0, row.costPrice || 0, row.quantity || 1);
  for (const input of identified) {
    if (input.id || input.productId) continue;
    const candidates = historicNull.filter((line) => !used.has(line.id) && oldKey(line) === newKey(input));
    const allNullCandidates = previous.filter(
      (line) => line.product_id === null && !used.has(line.id) && oldKey(line) === newKey(input),
    );
    const incoming = identified.filter((row) => !row.id && !row.productId && newKey(row) === newKey(input));
    if (
      candidates.length > 1 ||
      (candidates.length === 1 && (incoming.length !== 1 || allNullCandidates.length !== 1))
    ) {
      throw new ConflictException({
        message: 'Старые строки товара неоднозначны. Обновите экран и приложение перед правкой',
      });
    }
    if (candidates.length === 1) {
      input.id = candidates[0].id;
      used.add(input.id);
    }
  }
  if (historicNull.some((line) => !used.has(line.id)) && identified.some((row) => !row.id && !row.productId)) {
    throw new ConflictException({
      message: 'Правка удалённого товара требует исходной строки. Обновите экран и приложение',
    });
  }
  return identified.map((input) => ({ ...input, id: input.id || randomUUID() }));
}
interface Snapshot {
  product_id: string;
  decision: 'revenue_v2' | 'margin_v1' | 'none';
  rule_id: string | null;
  percent: string;
  qty: string;
  revenue_base: string;
  sale_lines: SavedLine[];
  accrued_at: Date;
  product_name: string | null;
}

export async function archiveLegacyMotivation(
  client: PoolClient,
  tenant: string,
  checkId: string | null,
  productId: string | null,
  protect: boolean,
): Promise<void> {
  if (!checkId && !productId) throw new Error('Legacy archive requires a check or product');
  await client.query(
    `INSERT INTO check_motivation_legacy_snapshots(tenant_id,check_id,product_id,employee_id,percent,accrued_at,protected)
    SELECT tenant_id,check_id,product_id,employee_id,percent,accrued_at,$4 FROM motivation_accruals
    WHERE tenant_id=$1 AND scheme='margin_v1' AND product_id IS NOT NULL
      AND ($2::uuid IS NULL OR check_id=$2) AND ($3::uuid IS NULL OR product_id=$3)
    ON CONFLICT(tenant_id,check_id,product_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,percent=EXCLUDED.percent,
      accrued_at=EXCLUDED.accrued_at,protected=EXCLUDED.protected
    WHERE check_motivation_legacy_snapshots.protected=false`,
    [tenant, checkId, productId, protect],
  );
  if (protect)
    await client.query(
      `UPDATE check_motivation_legacy_snapshots SET protected=true WHERE tenant_id=$1 AND product_id=$2`,
      [tenant, productId],
    );
}

/** Explicit performers are a money input, unlike historical board-only defaults. */
export async function confirmMotivationAssignees(
  client: PoolClient,
  tenant: string,
  check: string,
  raw: unknown,
  intent?: boolean,
): Promise<void> {
  if (!Array.isArray(raw) || raw.length > 50 || raw.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    throw new BadRequestException({ message: 'Выберите не более 50 исполнителей' });
  }
  const ids = [...new Set((raw as string[]).map((id) => id.toLowerCase()))].sort();
  const previous = (
    await client.query<{ motivation_assignees_confirmed: boolean }>(
      'SELECT motivation_assignees_confirmed FROM checks WHERE tenant_id=$1 AND id=$2',
      [tenant, check],
    )
  ).rows[0];
  const previousIds = (
    await client.query<{ user_id: string }>(
      'SELECT user_id FROM check_assignees WHERE tenant_id=$1 AND check_id=$2 ORDER BY user_id',
      [tenant, check],
    )
  ).rows.map((r) => r.user_id);
  const unchanged = ids.length === previousIds.length && ids.every((id, index) => id === previousIds[index]);
  const confirmed =
    intent === true || (intent === undefined && previous?.motivation_assignees_confirmed === true && unchanged);
  const users = (
    await client.query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::uuid[])
    AND is_active=true AND dismissed_at IS NULL AND purged_at IS NULL`,
      [tenant, ids],
    )
  ).rows;
  if (users.length !== ids.length)
    throw new BadRequestException({ message: 'Исполнитель не найден или больше не работает' });
  await client.query('DELETE FROM check_assignees WHERE tenant_id=$1 AND check_id=$2', [tenant, check]);
  if (ids.length)
    await client.query(`INSERT INTO check_assignees(tenant_id,check_id,user_id) SELECT $1,$2,unnest($3::uuid[])`, [
      tenant,
      check,
      ids,
    ]);
  await client.query('UPDATE checks SET motivation_assignees_confirmed=$3 WHERE id=$1 AND tenant_id=$2', [
    check,
    tenant,
    confirmed,
  ]);
}

export function assertMotivationAssignmentPermission(allowed: boolean): void {
  if (!allowed)
    throw new ForbiddenException({
      message: 'Изменение исполнителей проведённой акции требует права редактировать закрытый заказ-наряд',
    });
}

/** Caller owns the check row lock (or has freshly inserted the check). */
export async function snapshotCheckMotivation(
  client: PoolClient,
  tenant: string,
  checkId: string,
  mode: 'post' | 'edit' | 'restore',
) {
  // Reentrant shared backstop, never upgrade a financial reader to exclusive.
  await lockMotivationRead(client, tenant);
  let check = (
    await client.query<CheckState>(
      `SELECT id,discount,payment_method,motivation_v2_posted_at,motivation_assignees_confirmed
    FROM checks WHERE tenant_id=$1 AND id=$2`,
      [tenant, checkId],
    )
  ).rows[0];
  if (!check) throw new Error('Locked check missing');
  const freshPosting = mode === 'post' && !check.motivation_v2_posted_at;
  if (freshPosting) {
    check = (
      await client.query<CheckState>(
        `UPDATE checks SET motivation_v2_posted_at=now() WHERE tenant_id=$1 AND id=$2
      RETURNING id,discount,payment_method,motivation_v2_posted_at,motivation_assignees_confirmed`,
        [tenant, checkId],
      )
    ).rows[0];
  }
  // Historical paid checks have no posting boundary; edits/restores must not backfill v2.
  if (!check.motivation_v2_posted_at) return;
  if (mode !== 'restore') {
    const snapshots = (
      await client.query<Snapshot>('SELECT * FROM check_motivation_snapshots WHERE tenant_id=$1 AND check_id=$2', [
        tenant,
        checkId,
      ])
    ).rows;
    // Strict no-retroactivity: current config is read ONLY at first sale posting.
    const rules = freshPosting ? await readRules(client, tenant) : [];
    const legacy = new Set(
      freshPosting
        ? (
            await client.query<{ product_id: string }>(
              'SELECT product_id FROM motivation_promo_products WHERE tenant_id=$1',
              [tenant],
            )
          ).rows.map((row) => row.product_id)
        : [],
    );
    const lines = (
      await client.query<Line>(
        `SELECT pl.id,pl.product_id,pl.quantity,pl.total_sell,pl.name,p.category,p.warehouse_id
      FROM check_product_lines pl LEFT JOIN products p ON p.id=pl.product_id AND p.tenant_id=$1
      WHERE pl.check_id=$2 ORDER BY pl.id`,
        [tenant, checkId],
      )
    ).rows
      .map((line) => ({
        ...line,
        product_id:
          line.product_id ||
          snapshots.find((snapshot) => snapshot.sale_lines.some((saved) => saved.id === line.id))?.product_id ||
          null,
      }))
      .sort(
        (a, b) =>
          (a.product_id || '').localeCompare(b.product_id || '') ||
          a.name.localeCompare(b.name) ||
          a.quantity.localeCompare(b.quantity) ||
          a.total_sell.localeCompare(b.total_sell) ||
          a.id.localeCompare(b.id),
      );
    const basketKey = digest({
      discount: String(scaled(check.discount, 2)),
      warranty: check.payment_method === 'warranty',
      lines: lines.map((line) => ({
        product: line.product_id,
        name: line.name,
        qty: String(scaled(line.quantity, 3)),
        gross: String(scaled(line.total_sell, 2)),
      })),
    });
    const bases = netProductBases(
      lines.map((line) => scaled(line.total_sell, 2)),
      scaled(check.discount, 2),
    );
    const products = new Set([
      ...snapshots.map((s) => s.product_id),
      ...lines.flatMap((l) => (l.product_id ? [l.product_id] : [])),
    ]);
    for (const productId of products) {
      const old = snapshots.find((s) => s.product_id === productId);
      const current = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.product_id === productId);
      let decision = old?.decision,
        ruleId = old?.rule_id ?? null,
        rate = old?.percent ?? '0';
      if (!old) {
        const productLine = current[0]?.line;
        if (!productLine) throw new Error('Missing product decision');
        const rule = effectiveRule(
          { id: productId, category: productLine.category, warehouse_id: productLine.warehouse_id },
          rules,
        );
        decision = legacy.has(productId)
          ? 'margin_v1'
          : freshPosting && rule?.active && Number(rule.percent) > 0 && check.payment_method !== 'warranty'
            ? 'revenue_v2'
            : 'none';
        ruleId = rule?.id || null;
        rate = decision === 'revenue_v2' ? rule!.percent : '0';
      }
      const saved: SavedLine[] = current.map(({ line, index }) => ({
        id: line.id,
        quantity: line.quantity,
        netCents: String(bases[index]),
        grossCents: String(scaled(line.total_sell, 2)),
        basketKey,
      }));
      // A UUID rewrite is not a sale correction. Preserve original net cents when the full basket is identical.
      const unchanged = !!old?.sale_lines.length && old.sale_lines.every((line) => line.basketKey === basketKey);
      if (unchanged && old) {
        const available = [...old.sale_lines];
        for (const line of saved) {
          const index = available.findIndex(
            (prior) => prior.grossCents === line.grossCents && scaled(prior.quantity, 3) === scaled(line.quantity, 3),
          );
          if (index < 0) throw new Error('Unchanged basket lost a saved line');
          line.netCents = available[index].netCents;
          available.splice(index, 1);
        }
      }
      const qty = current.reduce((sum, { line }) => sum + scaled(line.quantity, 3), 0n);
      const base =
        check.payment_method === 'warranty' ? 0n : saved.reduce((sum, line) => sum + BigInt(line.netCents), 0n);
      await client.query(
        `INSERT INTO check_motivation_snapshots(tenant_id,check_id,product_id,decision,rule_id,percent,qty,revenue_base,sale_lines,accrued_at,product_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        ON CONFLICT(tenant_id,check_id,product_id) DO UPDATE SET qty=EXCLUDED.qty,revenue_base=EXCLUDED.revenue_base,sale_lines=EXCLUDED.sale_lines`,
        [
          tenant,
          checkId,
          productId,
          decision,
          ruleId,
          rate,
          decimal(qty, 3),
          decimal(base),
          JSON.stringify(saved),
          check.motivation_v2_posted_at,
          old?.product_name || current[0]?.line.name || null,
        ],
      );
    }
  }
  await writeRevenueAccruals(client, tenant, checkId);
}

/** Reassignment uses saved decisions/bases, without re-resolving rules or moving attribution time. */
export async function writeRevenueAccruals(client: PoolClient, tenant: string, checkId: string): Promise<void> {
  await client.query(`DELETE FROM motivation_accruals WHERE tenant_id=$1 AND check_id=$2 AND scheme='revenue_v2'`, [
    tenant,
    checkId,
  ]);
  const recipients = (
    await client.query<{ user_id: string }>(
      `SELECT a.user_id FROM check_assignees a
    JOIN checks c ON c.id=a.check_id AND c.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.check_id=$2 AND c.motivation_assignees_confirmed=true
      AND NOT (c.is_returned=true AND c.return_scope='full') ORDER BY a.user_id`,
      [tenant, checkId],
    )
  ).rows;
  if (!recipients.length) return;
  const snapshots = (
    await client.query<Snapshot>(
      `SELECT * FROM check_motivation_snapshots WHERE tenant_id=$1 AND check_id=$2 AND decision='revenue_v2'`,
      [tenant, checkId],
    )
  ).rows;
  for (const snapshot of snapshots) {
    const currentProduct =
      (
        await client.query<{ id: string }>('SELECT id FROM products WHERE tenant_id=$1 AND id=$2', [
          tenant,
          snapshot.product_id,
        ])
      ).rows[0]?.id || null;
    const base = scaled(snapshot.revenue_base, 2);
    const { total, shares } = bonusShares(base, snapshot.percent, recipients.length);
    for (const [index, recipient] of recipients.entries()) {
      if (shares[index] <= 0n) continue;
      await client.query(
        `INSERT INTO motivation_accruals(tenant_id,employee_id,check_id,product_id,qty,margin_base,percent,amount,accrued_at,scheme,revenue_base,share_index,share_count,total_bonus,rule_id,snapshot_product_id)
        VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,'revenue_v2',$9,$10,$11,$12,$13,$14)`,
        [
          tenant,
          recipient.user_id,
          checkId,
          currentProduct,
          snapshot.qty,
          snapshot.percent,
          decimal(shares[index]),
          snapshot.accrued_at,
          snapshot.revenue_base,
          index + 1,
          recipients.length,
          decimal(total),
          snapshot.rule_id,
          snapshot.product_id,
        ],
      );
    }
  }
}

/** Only sold quantities returned at their saved net basis reduce the new bonus. */
export async function returnRevenueMotivation(
  client: PoolClient,
  tenant: string,
  checkId: string,
  moves: Array<{ productLineId: string | null; quantity: number }>,
  full: boolean,
): Promise<void> {
  if (full) {
    await client.query(`DELETE FROM motivation_accruals WHERE tenant_id=$1 AND check_id=$2 AND scheme='revenue_v2'`, [
      tenant,
      checkId,
    ]);
    return;
  }
  const snapshots = (
    await client.query<Snapshot>(
      `SELECT * FROM check_motivation_snapshots WHERE tenant_id=$1 AND check_id=$2 AND decision='revenue_v2'`,
      [tenant, checkId],
    )
  ).rows;
  for (const snapshot of snapshots) {
    let returnedBase = 0n,
      returnedQty = 0n;
    for (const line of snapshot.sale_lines) {
      const move = moves.find((m) => m.productLineId === line.id);
      if (!move) continue;
      const qty = scaled(line.quantity, 3),
        wanted = scaled(move.quantity, 3),
        units = wanted > qty ? qty : wanted;
      if (qty > 0n) returnedBase += roundRatio(BigInt(line.netCents) * units, qty);
      returnedQty += units;
    }
    const base = scaled(snapshot.revenue_base, 2),
      qty = scaled(snapshot.qty, 3);
    await client.query(
      `UPDATE check_motivation_snapshots SET revenue_base=$4,qty=$5 WHERE tenant_id=$1 AND check_id=$2 AND product_id=$3`,
      [
        tenant,
        checkId,
        snapshot.product_id,
        decimal(base > returnedBase ? base - returnedBase : 0n),
        decimal(qty > returnedQty ? qty - returnedQty : 0n, 3),
      ],
    );
  }
  await writeRevenueAccruals(client, tenant, checkId);
}
