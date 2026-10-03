import type { Ionicons } from '@expo/vector-icons';

// Human-readable Russian labels for the platform audit actions. Keys mirror the
// FACTUAL audit.log()/audit.logTx() calls in backend (single source of truth —
// frontend/src/components/admin/auditActions.ts, сверен grep'ом по backend/src):
//   tenants.service.ts       → tenant_extend, tenant_change_plan, tenant_suspend,
//                              tenant_unsuspend, impersonate, tenant_toggle_active,
//                              tenant_delete
//   registration.service.ts  → registration_approve, registration_reject
//   notifications.service.ts → broadcast_cancel
//   checks.service.ts        → check_closed_edit
//   менеджеры (173)          → tenant_create, tenant_transfer_manager, manager_create,
//                              manager_update, manager_settlement, owner_password_reset
// Unknown actions fall back to a humanised version of the raw key.
const ACTION_LABELS: Record<string, string> = {
  tenant_extend: 'Продление подписки',
  tenant_change_plan: 'Смена тарифа',
  tenant_suspend: 'Приостановка',
  tenant_unsuspend: 'Возобновление работы',
  impersonate: 'Вход как владелец',
  tenant_toggle_active: 'Вкл/выкл автосервиса',
  tenant_delete: 'Удаление автосервиса',
  registration_approve: 'Заявка одобрена',
  registration_reject: 'Заявка отклонена',
  broadcast_cancel: 'Рассылка отменена',
  check_closed_edit: 'Правка закрытого чека',
  tenant_create: 'Создание автосервиса',
  tenant_transfer_manager: 'Передача клиента менеджеру',
  manager_create: 'Создание менеджера',
  manager_update: 'Правка менеджера',
  manager_settlement: 'Расчёт с менеджером',
  owner_password_reset: 'Сброс пароля владельца',
};

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const words = action.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionIcon(action: string): keyof typeof Ionicons.glyphMap {
  if (action.includes('impersonate')) return 'enter-outline';
  if (action.startsWith('registration')) return 'mail-open-outline';
  if (action.startsWith('broadcast')) return 'megaphone-outline';
  if (action.startsWith('check')) return 'receipt-outline';
  if (action === 'manager_settlement') return 'cash-outline';
  if (action.startsWith('manager')) return 'people-outline';
  if (action === 'owner_password_reset') return 'lock-closed-outline';
  if (action === 'tenant_transfer_manager') return 'swap-horizontal-outline';
  if (action.startsWith('tenant')) return 'business-outline';
  if (action.startsWith('plan')) return 'pricetags-outline';
  if (action.startsWith('user')) return 'person-outline';
  return 'ellipse-outline';
}
