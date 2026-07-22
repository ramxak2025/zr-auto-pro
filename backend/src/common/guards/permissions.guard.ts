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
 *   • director   — tenant owner («Директор всегда полные права» — продуктовое
 *                  правило, роль «Директор» вечно read-only с полной матрицей).
 *
 * `admin` СНЯТ из owner-class (волна «права как в Битрикс24», 2026-07): матрица
 * роли АВТОРИТЕТНА — администратор решается матрицей назначенной роли, как
 * любой сотрудник. Системный «Администратор» засеян полным доступом (кроме
 * owner-only ячеек: salary.payouts, equipment.permanentDelete,
 * settings.company, employees.approveProfile — миграция 136), поэтому для
 * нетронутых тенантов поведение 1:1; урезанная владельцем матрица «Администратора»
 * теперь реально действует. admin с role_id NULL (аномалия после cutover 126)
 * не запирается — падает на ADMIN_PERMISSION_DEFAULTS ниже.
 */
const OWNER_CLASS_ROLES = new Set(['superadmin', 'director']);

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
  // Охват редактирования чужих чеков — off by default (master edits only own).
  checks_edit_all: false,
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
  // Услуги — мастер СМОТРИТ услуги и добавляет их в чек (view), но не редактирует
  // каталог/проценты/гарантию (manage off).
  services_view: true,
  services_manage: false,
  // Финансы — none by default.
  profit_view: false,
  financial_reports: false,
  export_data: false,
  can_add_expenses: false,
  salary_view: false,
  salary_view_all: false,
  // «Движение денег» (ITEM 6) — off by default. Масштаб охвата решает матрица
  // роли (reports.cashflow: own|all); для легаси-мастера без матрицы дефолт
  // false = БЕЗ доступа, ровно как сегодня (эндпоинт был owner-class). Владелец
  // выдаёт «свои» (cashflow_view) или «все» (cashflow_view_all) явно — opt-in.
  cashflow_view: false,
  cashflow_view_all: false,
  // Склад — мастер СМОТРИТ товары (без себестоимости) и добавляет их в чек (view);
  // себестоимость / add-edit / инвентаризация (manage) и удаление (delete) — off.
  warehouse_access: true,
  warehouse_manage: false,
  // Удаление товаров/папок (#60) — off by default; owner grants explicitly. Gates
  // DELETE /products/:id (soft) and DELETE /warehouse/categories/:id (soft, cascades).
  warehouse_delete: false,
  // Поставщики — none by default (view + manage off).
  suppliers_access: false,
  suppliers_manage: false,
  // Имущество — none by default (view + manage off).
  equipment_view: false,
  equipment_manage: false,
  // CRM — own clients/cars + own schedule; broad editing/marketing/calls off.
  clients_view: true,
  clients_edit: false,
  schedule_view: true,
  bookings_access: false,
  marketing_access: false,
  // Управление маркетингом (волна F) — off by default для мастера (роут owner/
  // admin-class). Значение и так резолвится в false, но фиксируем явно для
  // консистентности с остальной картой.
  marketing_manage: false,
  calls_view: false,
  calls_listen: false,
  // Управление — never for a master.
  user_management: false,
  // ── v3 (миграция 136) — новые ключи: мастеру всё off (эти роуты и раньше
  // были @Roles(d,a,sa) / owner-only — мастер туда не проходил, сид 1:1).
  cash_shifts_manage: false,
  checks_board_manage: false,
  clients_delete: false,
  debts_manage: false,
  schedule_manage: false,
  salary_payouts_manage: false,
  salary_premiums_manage: false,
  motivation_manage: false,
  warehouse_analytics_view: false,
  equipment_permanent_delete: false,
  employees_approve_profile: false,
  settings_manage: false,
  company_manage: false,
  knowledge_manage: false,
  // Просмотр базы знаний (волна F) — true: чтение базы знаний было открыто ВСЕМ
  // до появления ключа. Без явного дефолта легаси-мастер без матрицы (role_id
  // NULL) потерял бы просмотр = регресс.
  knowledge_view: true,
};

/**
 * Зеркало матрицы системного «Администратора» (сиды 114/121/125/126/136) — тот
 * же лок-аут-страховочный механизм, что MASTER_PERMISSION_DEFAULTS, но для
 * строковой роли `admin`. Консультируется ТОЛЬКО когда у admin-пользователя нет
 * матрицы (role_id NULL — аномалия после cutover-миграции 126): после снятия
 * `admin` из OWNER_CLASS_ROLES такой пользователь без этого фолбэка оказался бы
 * полностью заперт (риск R2 карты перевода). MUST stay in sync с сидом
 * системной роли «Администратор»: всё true, КРОМЕ четырёх owner-only действий,
 * где admin и сегодня исключён из @Roles (salary payouts/penalties, equipment
 * permanentDelete, profile change-requests, /my-company) — они false.
 */
const ADMIN_PERMISSION_DEFAULTS: Record<string, boolean> = {
  // Касса — полный доступ (сид «Администратора»: checks.* всё true/'all').
  checks_view: true,
  checks_view_all: true,
  checks_create: true,
  checks_edit: true,
  checks_edit_all: true,
  checks_delete: true,
  checks_change_datetime: true,
  edit_closed_check: true,
  payment_edit: true,
  accept_payment: true,
  sell_installment: true,
  cash_shifts_manage: true,
  checks_board_manage: true,
  // Услуги / Склад / Поставщики / Имущество.
  services_view: true,
  services_manage: true,
  warehouse_access: true,
  warehouse_manage: true,
  warehouse_delete: true,
  warehouse_analytics_view: true,
  suppliers_access: true,
  suppliers_manage: true,
  equipment_view: true,
  equipment_manage: true,
  equipment_permanent_delete: false, // owner-only: DELETE /equipment/:id — @Roles(d,sa) без admin
  // CRM.
  clients_view: true,
  clients_edit: true,
  clients_delete: true,
  debts_manage: true,
  schedule_view: true,
  schedule_manage: true,
  bookings_access: true,
  marketing_access: true,
  // Управление маркетингом (волна F) — true: зеркало сида системного
  // «Администратора» (миграция 137, marketing_manage=true).
  marketing_manage: true,
  calls_view: true,
  calls_listen: true,
  // Финансы.
  profit_view: true,
  financial_reports: true,
  export_data: true,
  cashflow_view: true,
  cashflow_view_all: true,
  can_add_expenses: true,
  salary_view: true,
  salary_view_all: true,
  salary_payouts_manage: false, // owner-only: OWNER_ROLES=['director','superadmin'] в salary.controller
  salary_premiums_manage: true,
  motivation_manage: true,
  // Управление / Настройки / База знаний.
  user_management: true,
  employees_approve_profile: false, // owner-only: profile change-requests — @Roles(d,sa) без admin
  settings_manage: true,
  company_manage: false, // owner-only: /my-company — @Roles(d,sa) без admin
  knowledge_manage: true,
  // Просмотр базы знаний (волна F) — true: зеркало сида системного
  // «Администратора» (миграция 137, knowledge_view=true).
  knowledge_view: true,
};

/**
 * Resolve whether `user` holds `permission`. Exported (and pure) so the
 * decision is unit-testable and reusable from services (e.g. checks_view_all).
 *
 * Rule:
 *   1. Owner-class role (superadmin/director)       → ALWAYS allowed.
 *   2. Explicit `permissions[key] === true`         → allowed.
 *   3. Explicit `permissions[key] === false`        → denied.
 *   4. No explicit entry → fall back to the per-role default
 *      (master: MASTER_PERMISSION_DEFAULTS; admin без матрицы (role_id NULL):
 *      ADMIN_PERMISSION_DEFAULTS; any other non-owner role: deny).
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
  // admin без матрицы (role_id NULL — аномалия после cutover 126): зеркало сида
  // системного «Администратора», иначе снятие admin из owner-class заперло бы
  // его полностью (R2).
  if (user.role === 'admin') return ADMIN_PERMISSION_DEFAULTS[permission] === true;

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
