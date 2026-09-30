import type { Tone } from '../../ui/tokens';

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
 *   managers (2026-09-30)   → tenant_create, tenant_transfer_manager, manager_create,
 *                             manager_update, manager_settlement, owner_password_reset
 *
 * Прежний словарь страницы использовал вымышленную dot-нотацию
 * ('tenant.create', 'plan.update', …) — ни один ключ не совпадал, журнал
 * показывал сырые snake_case-ключи. Неизвестные ключи по-прежнему выводятся
 * как есть (нейтральным бейджем) — новые действия backend не потеряются.
 *
 * Тон — по смыслу визуальной системы: ok — деньги/возобновление, bad —
 * приостановка/удаление/отказ, warn — требует внимания (вход от имени
 * владельца, вкл/выкл), accent — смена тарифа, info — правка закрытого чека.
 */

export const AUDIT_ACTION_META: Record<string, { label: string; tone: Tone }> = {
  tenant_extend: { label: 'Продление подписки', tone: 'ok' },
  tenant_change_plan: { label: 'Смена тарифа', tone: 'accent' },
  tenant_suspend: { label: 'Приостановка', tone: 'bad' },
  tenant_unsuspend: { label: 'Возобновление работы', tone: 'ok' },
  impersonate: { label: 'Вход как владелец', tone: 'warn' },
  tenant_toggle_active: { label: 'Вкл/выкл автосервиса', tone: 'warn' },
  tenant_delete: { label: 'Удаление автосервиса', tone: 'bad' },
  registration_approve: { label: 'Заявка одобрена', tone: 'ok' },
  registration_reject: { label: 'Заявка отклонена', tone: 'bad' },
  broadcast_cancel: { label: 'Рассылка отменена', tone: 'neutral' },
  check_closed_edit: { label: 'Правка закрытого чека', tone: 'info' },
  // Менеджеры платформы (2026-09-30): создание клиента и всё, что связано с менеджером.
  tenant_create: { label: 'Создание автосервиса', tone: 'ok' },
  tenant_transfer_manager: { label: 'Передача клиента менеджеру', tone: 'accent' },
  manager_create: { label: 'Создание менеджера', tone: 'ok' },
  manager_update: { label: 'Правка менеджера', tone: 'info' },
  manager_settlement: { label: 'Расчёт с менеджером', tone: 'ok' },
  owner_password_reset: { label: 'Сброс пароля владельца', tone: 'warn' },
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_META[action]?.label ?? action;
}

export function auditActionTone(action: string): Tone {
  return AUDIT_ACTION_META[action]?.tone ?? 'neutral';
}
