import type { CashShiftReport, DashboardV2, PointsListResponse } from '../../../../../shared/types';
import { ownerTeamToday } from './ownerHomeTeam';

export type OwnerCashPayments = {
  cash: number;
  card: number;
  total: number;
  warranty: number;
  warrantyLoss: number | null;
  installmentPaid: number | null;
  installmentPaidCash: number | null;
  installmentPaidCard: number | null;
};

const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => money(value) && value >= 0;
const agrees = (total: number, first: number, second: number) => Math.abs(total - first - second) < 0.011;

/**
 * Check payment legs already include the initial installment payment and net
 * returns against the source check. Later installments remain a separate
 * ledger. Preserve the server total; never call this a drawer/card balance or
 * re-add a refund, warranty value, installment debt, or initial payment.
 */
export function ownerCashPayments(value: unknown): OwnerCashPayments | null {
  const dashboard = value as Partial<DashboardV2> | null;
  const cash = dashboard?.cashPosition;
  if (
    dashboard?.period !== 'today' ||
    !cash ||
    !money(cash.cash) ||
    !money(cash.card) ||
    !money(cash.total) ||
    !agrees(cash.total, cash.cash, cash.card) ||
    !nonnegative(cash.warranty)
  )
    return null;
  const optional = [cash.warrantyLoss, cash.installmentPaid, cash.installmentPaidCash, cash.installmentPaidCard];
  if (optional.some((amount) => amount !== undefined && !nonnegative(amount))) return null;
  const splitCash = cash.installmentPaidCash ?? null;
  const splitCard = cash.installmentPaidCard ?? null;
  const paid = cash.installmentPaid ?? null;
  // An older server may omit the entire split. A partial/inconsistent split is
  // unavailable rather than a fabricated zero or a new client-made total.
  if ((splitCash === null) !== (splitCard === null)) return null;
  if (splitCash !== null && splitCard !== null && (paid === null || !agrees(paid, splitCash, splitCard))) return null;
  return {
    cash: cash.cash,
    card: cash.card,
    total: cash.total,
    warranty: cash.warranty,
    warrantyLoss: cash.warrantyLoss ?? null,
    installmentPaid: paid,
    installmentPaidCash: splitCash,
    installmentPaidCard: splitCard,
  };
}

export type OwnerCashPoint =
  | { kind: 'ready'; pointId: string | null; name: string | null }
  | { kind: 'choose' }
  | { kind: 'unknown' }
  | { kind: 'mismatch' };

/**
 * current() is LIMIT 1, not a network-wide sum. With no session point, only a
 * confirmed tenant without live points may display that unscoped cash box.
 * Metadata is the same cached /points response used by the home toolbar.
 */
export function ownerCashPoint(
  sessionPointId: string | null,
  metadata: PointsListResponse | undefined,
): OwnerCashPoint {
  if (metadata && metadata.currentPointId !== sessionPointId) return { kind: 'mismatch' };
  if (metadata && !Array.isArray(metadata.points)) return { kind: 'unknown' };
  if (sessionPointId) {
    const selected = metadata?.points.find((point) => point?.id === sessionPointId);
    return { kind: 'ready', pointId: sessionPointId, name: typeof selected?.name === 'string' ? selected.name : null };
  }
  if (!metadata || !Array.isArray(metadata.points)) return { kind: 'unknown' };
  if (metadata.points.length) return { kind: 'choose' };
  return { kind: 'ready', pointId: null, name: null };
}

export type OwnerCashShift =
  | { kind: 'closed' }
  | { kind: 'open'; id: string; pointId: string | null; expectedAmount: number; openedAt: string };

/** Read the canonical accounting balance only; no client-side reconciliation. */
export function ownerCashShift(value: unknown, point: OwnerCashPoint, tenantId: string | null): OwnerCashShift | null {
  if (point.kind !== 'ready') return null;
  // Nest's null response can arrive as an empty body through axios.
  if (value === null || value === '') return { kind: 'closed' };
  const report = value as Partial<CashShiftReport> | undefined;
  const shift = report?.shift;
  if (
    !shift ||
    typeof shift.id !== 'string' ||
    !shift.id ||
    shift.status !== 'open' ||
    shift.closedAt ||
    typeof shift.tenantId !== 'string' ||
    (tenantId !== null && shift.tenantId !== tenantId) ||
    (shift.pointId ?? null) !== point.pointId ||
    typeof shift.openedAt !== 'string' ||
    !Number.isFinite(Date.parse(shift.openedAt)) ||
    !money(report?.expectedAmount)
  )
    return null;
  return {
    kind: 'open',
    id: shift.id,
    pointId: shift.pointId ?? null,
    expectedAmount: report.expectedAmount,
    openedAt: shift.openedAt,
  };
}

/** Only a display freshness check. The API always chooses its own tenant today. */
export function ownerCashIsToday(updatedAt: number | undefined, timezone: string, now = new Date()): boolean {
  return (
    !!updatedAt &&
    Number.isFinite(updatedAt) &&
    ownerTeamToday(timezone, new Date(updatedAt)) === ownerTeamToday(timezone, now)
  );
}
