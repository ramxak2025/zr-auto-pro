import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

export interface RuleRow {
  id: string;
  tenant_id: string;
  target_kind: 'product' | 'folder';
  product_id: string | null;
  category_id: string | null;
  percent: string;
  before_discount: boolean;
  active: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
  path: string | null;
  warehouse_id: string | null;
  folder_deleted_at: Date | null;
  product_name: string | null;
}
export interface ProductIdentity {
  id: string;
  category: string | null;
  warehouse_id: string | null;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invalid(message: string): never {
  throw new BadRequestException({ code: 'MOTIVATION_INVALID_INPUT', message });
}
export function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
export function missing(): never {
  throw new NotFoundException({ code: 'MOTIVATION_RULE_NOT_FOUND', message: 'Правило не найдено' });
}
/** Same segment normalization as shared/utils/productFolders. No LIKE/wildcard semantics. */
export function normalizePath(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}
export function withinFolder(category: string | null, folder: string): boolean {
  const path = normalizePath(category || '');
  return path === folder || path.startsWith(folder + '/');
}
/** Configuration/catalog writers take exclusive BEFORE touching FK parent rows. */
export async function lockMotivation(client: PoolClient, tenant: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('motivation-v2'), hashtext($1))`, [tenant]);
}
/** Financial writers take this BEFORE any check/product row lock. Config takes exclusive first. */
export async function lockMotivationRead(client: PoolClient, tenant: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock_shared(hashtext('motivation-v2'), hashtext($1))`, [tenant]);
}
export async function readRules(client: PoolClient, tenant: string): Promise<RuleRow[]> {
  const { rows } = await client.query<RuleRow>(
    `SELECT r.*, wc.path, wc.warehouse_id, wc.deleted_at AS folder_deleted_at, p.name AS product_name
       FROM motivation_rules r
       LEFT JOIN warehouse_categories wc ON wc.id=r.category_id AND wc.tenant_id=r.tenant_id
       LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1 ORDER BY r.id`,
    [tenant],
  );
  return rows;
}
/** Paused specific rules win too: they suppress inherited rules. */
export function effectiveRule(product: ProductIdentity, rules: RuleRow[]): RuleRow | undefined {
  const direct = rules.find((rule) => rule.target_kind === 'product' && rule.product_id === product.id);
  if (direct) return direct;
  return rules
    .filter(
      (rule) =>
        rule.target_kind === 'folder' &&
        rule.folder_deleted_at === null &&
        rule.path !== null &&
        rule.warehouse_id === product.warehouse_id &&
        withinFolder(product.category, normalizePath(rule.path)),
    )
    .sort(
      (a, b) =>
        normalizePath(b.path!).split('/').length - normalizePath(a.path!).split('/').length || a.id.localeCompare(b.id),
    )[0];
}
export function mapRule(rule: RuleRow) {
  return {
    id: rule.id,
    target:
      rule.target_kind === 'product'
        ? { kind: 'product' as const, productId: rule.product_id! }
        : { kind: 'folder' as const, warehouseId: rule.warehouse_id, categoryId: rule.category_id!, path: rule.path! },
    calculationBase: 'revenue' as const,
    percent: Number(rule.percent),
    beforeDiscount: rule.before_discount,
    active: rule.active,
    revision: rule.revision,
    createdAt: rule.created_at.toISOString(),
    updatedAt: rule.updated_at.toISOString(),
    ...(rule.product_name ? { productName: rule.product_name } : {}),
  };
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
