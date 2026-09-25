/**
 * Кто какой отчёт видит — ОДНО правило для каталога (available/reason) и для
 * запуска (403 с тем же текстом). Чистые функции: без БД, тестируемы.
 *
 * Правило (спека, раздел 1):
 *   • owner-class (director / superadmin) — всё, кроме ограничения «≥ 2
 *     филиалов» у 'points' (оно про данные, а не про права);
 *   • иначе достаточно права `financial_reports` (как у /reports/financial)
 *     ЛИБО права конкретного отчёта из каталога — завскладом открывает «По
 *     товарам» по `warehouse_access`, не имея финансовых прав;
 *   • ownerOnly-отчёт для не-owner-class закрыт независимо от прав.
 *
 * Глобальный суперадмин без тенанта отчётов не имеет: считать нечего.
 */
import { userHasPermission } from '../../common/guards/permissions.guard';
import { isTenantLess } from '../../common/auth-cache';
import { ReportDefinition } from './catalog';

const OWNER_CLASS_ROLES = new Set(['superadmin', 'director']);

export interface AccessActor {
  role?: string;
  tenantID?: string;
  permissions?: Record<string, boolean>;
}

/** Человеческие названия прав — для reason в каталоге и текста 403. */
const PERMISSION_LABELS: Record<string, string> = {
  financial_reports: 'Отчёты',
  salary_view: 'Зарплата',
  suppliers_access: 'Поставщики',
  clients_view: 'Клиенты',
  warehouse_access: 'Склад',
  bookings_access: 'Записи',
};

export function isOwnerClass(actor: AccessActor | undefined): boolean {
  return !!actor?.role && OWNER_CLASS_ROLES.has(actor.role);
}

export interface ReportAvailability {
  available: boolean;
  reason?: string | null;
}

export function reportAvailability(
  actor: AccessActor | undefined,
  def: ReportDefinition,
  activePointsCount: number,
): ReportAvailability {
  if (!actor || isTenantLess(actor.tenantID)) {
    return { available: false, reason: 'Отчёты доступны внутри компании' };
  }
  const owner = isOwnerClass(actor);
  if (def.ownerOnly && !owner) {
    return { available: false, reason: 'Доступно только руководителю' };
  }
  if (def.requiresMultiPoint && activePointsCount < 2) {
    return { available: false, reason: 'У компании один филиал' };
  }
  if (owner) return { available: true, reason: null };
  if (userHasPermission(actor, 'financial_reports')) return { available: true, reason: null };
  if (def.permission && userHasPermission(actor, def.permission)) return { available: true, reason: null };

  const label = def.permission ? PERMISSION_LABELS[def.permission] : undefined;
  const reason =
    label && def.permission !== 'financial_reports' ? `Нужно право «Отчёты» или «${label}»` : 'Нужно право «Отчёты»';
  return { available: false, reason };
}
