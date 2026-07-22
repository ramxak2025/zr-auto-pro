/*
 * Единый словарь действий платформенного журнала (admin_audit_log).
 *
 * Ключи сверены с ФАКТИЧЕСКИМИ вызовами audit.log()/audit.logTx() в backend
 * (grep по backend/src, 2026-07):
 *   tenants.service.ts      → tenant_extend, tenant_change_plan, tenant_suspend,
 *                             tenant_unsuspend, impersonate, tenant_toggle_active,
 *                             tenant_delete
 *   registration.service.ts → registration_approve, registration_reject
 *   notifications.service.ts→ broadcast_cancel
 *   checks.service.ts       → check_closed_edit (транзакционная правка закрытого чека)
 *
 * Прежний словарь страницы использовал вымышленную dot-нотацию
 * ('tenant.create', 'plan.update', …) — ни один ключ не совпадал, журнал
 * показывал сырые snake_case-ключи. Неизвестные ключи по-прежнему выводятся
 * как есть (серым) — новые действия backend не потеряются.
 */

export type AuditTone = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple';

export const AUDIT_ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  tenant_extend: { label: 'Продление подписки', tone: 'green' },
  tenant_change_plan: { label: 'Смена тарифа', tone: 'blue' },
  tenant_suspend: { label: 'Приостановка', tone: 'red' },
  tenant_unsuspend: { label: 'Возобновление работы', tone: 'green' },
  impersonate: { label: 'Вход как владелец', tone: 'yellow' },
  tenant_toggle_active: { label: 'Вкл/выкл автосервиса', tone: 'yellow' },
  tenant_delete: { label: 'Удаление автосервиса', tone: 'red' },
  registration_approve: { label: 'Заявка одобрена', tone: 'green' },
  registration_reject: { label: 'Заявка отклонена', tone: 'red' },
  broadcast_cancel: { label: 'Рассылка отменена', tone: 'gray' },
  check_closed_edit: { label: 'Правка закрытого чека', tone: 'purple' },
};

const TONE_BADGE: Record<AuditTone, string> = {
  green: 'badge-green',
  red: 'badge-red',
  yellow: 'badge-yellow',
  blue: 'badge-blue',
  gray: 'badge-gray',
  purple: 'badge bg-purple-50 text-purple-700',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_META[action]?.label ?? action;
}

export function auditActionBadgeClass(action: string): string {
  return TONE_BADGE[AUDIT_ACTION_META[action]?.tone ?? 'gray'];
}
