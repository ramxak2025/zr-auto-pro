import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Require a specific action-permission to reach this handler. Pair with
 * PermissionsGuard in the controller's @UseGuards(...). Example:
 *
 *   @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
 *   @RequirePermission('marketing_access')
 *   @Post('integrations')  …
 */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

/**
 * Owner-class roles bypass the per-key permission check entirely. These are
 * the accounts that, by product rule, hold every permission implicitly:
 *   • superadmin — platform owner (also bypasses RolesGuard)
 *   • director   — tenant owner; AuthService grants directors ALL_PERMISSIONS
 *   • admin      — owner-class for now (we may carve out truly owner-only
 *                  actions later; keeping admin allowed avoids any lockout).
 */
const OWNER_CLASS_ROLES = new Set(['superadmin', 'director', 'admin']);

/**
 * Per-role DEFAULT applied when the user's stored permission map has no
 * explicit entry for the requested key. MUST stay in sync with
 * `ROLE_PERMISSION_DEFAULTS` in shared/types/index.ts (the backend can't import
 * the shared package — it's outside this tsconfig rootDir — so we mirror the
 * master row here, exactly like the visibility DTOs mirror SECTION_KEYS).
 *
 * Only `master` is meaningful: owner-class roles short-circuit above and never
 * consult this table. The net effect is the lockout-safety guarantee: an
 * existing master with `permissions = {}` keeps every master-legitimate action
 * (it's `true` here) and is denied the owner-only ones (absent / `false`).
 */
const MASTER_PERMISSION_DEFAULTS: Record<string, boolean> = {
  // Касса — masters use the cash screen and manage their own checks.
  checks_view: true,
  checks_create: true,
  checks_edit: true,
  checks_delete: false,
  checks_change_datetime: false,
  checks_view_all: false,
  payment_edit: false,
  // Кассир смены — off by default; the owner grants it explicitly. Only
  // consulted when the tenant's POS shift-mode is ON (092).
  accept_payment: false,
  // Право продавать в рассрочку (093) — off by default; owner grants explicitly.
  // Gates creating a check with paymentMethod 'installment'.
  sell_installment: false,
  // Редактирование закрытого (проведённого) заказ-наряда (#61) — off by default;
  // the owner grants it explicitly. Gates the closed-check cascade-recompute edit
  // path in ChecksService. Mirrors shared UserPermissions.edit_closed_check.
  edit_closed_check: false,
  // Финансы — none by default.
  profit_view: false,
  financial_reports: false,
  export_data: false,
  can_add_expenses: false,
  salary_view: false,
  // Склад — access flags off by default (reads are open elsewhere; mutations are role-gated).
  warehouse_access: false,
  // Удаление товаров/папок (#60) — off by default; owner grants explicitly. Gates
  // DELETE /products/:id (soft) and DELETE /warehouse/categories/:id (soft, cascades).
  warehouse_delete: false,
  suppliers_access: false,
  // CRM — own clients/cars + own schedule; broad editing/marketing/calls off.
  clients_view: true,
  clients_edit: false,
  schedule_view: true,
  bookings_access: false,
  marketing_access: false,
  calls_view: false,
  calls_listen: false,
  // Управление — never for a master.
  user_management: false,
};

/**
 * Resolve whether `user` holds `permission`. Exported (and pure) so the
 * decision is unit-testable and reusable from services (e.g. checks_view_all).
 *
 * Rule:
 *   1. Owner-class role (superadmin/director/admin) → ALWAYS allowed.
 *   2. Explicit `permissions[key] === true`         → allowed.
 *   3. Explicit `permissions[key] === false`        → denied.
 *   4. No explicit entry → fall back to the per-role default
 *      (master: MASTER_PERMISSION_DEFAULTS; any other non-owner role: deny).
 */
export function userHasPermission(
  user: { role?: string; permissions?: Record<string, boolean> } | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  if (user.role && OWNER_CLASS_ROLES.has(user.role)) return true;

  const explicit = user.permissions?.[permission];
  if (explicit === true) return true;
  if (explicit === false) return false;

  // No explicit grant/denial → per-role default.
  if (user.role === 'master') return MASTER_PERMISSION_DEFAULTS[permission] === true;

  // Unknown non-owner role with no explicit permission: deny (fail-closed).
  return false;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @RequirePermission on this route → allow (mirrors RolesGuard's
    // "no @Roles → allow" so the guard is safe to attach class-wide).
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (userHasPermission(user, required)) return true;

    throw new ForbiddenException({ message: 'Недостаточно прав для этого действия' });
  }
}
