import type { TenantsService } from '../tenants/tenants.service';

// Формы ответов модуля менеджеров платформы. Зеркалят раздел «Менеджеры платформы»
// в shared/types/index.ts (backend не может импортировать shared — он вне rootDir),
// поэтому при правке контракта менять оба места. Суммы — рубли (number), даты — ISO-строки
// (settledOn — 'YYYY-MM-DD').

/** Автосервис в форме списка тенантов (`Tenant` из shared), как его отдаёт TenantsService.getAll. */
export type TenantView = Awaited<ReturnType<TenantsService['getAll']>>[number];

/** Платёж/продление в форме `SubscriptionPayment` из shared (со снимком доли и тарифа). */
export type SubscriptionPaymentView = ReturnType<TenantsService['mapSubscriptionPayment']>;

export interface PlatformManager {
  id: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  ownerSharePercent: number;
  note: string | null;
  tenantsCount: number;
  activeTenantsCount: number;
  paidThisMonth: number;
  ownerShareThisMonth: number;
  balance: number;
  createdAt: string;
}

export interface ManagerTenantCounters {
  total: number;
  active: number;
  expired: number;
  suspended: number;
  expiringIn7d: number;
}

export interface ManagerMoney {
  paidThisMonth: number;
  ownerShareThisMonth: number;
  paidTotal: number;
  ownerShareTotal: number;
  settledTotal: number;
  balance: number;
}

/** Счётчики клиентов и деньги менеджера — сырьё для PlatformManager и ManagerSummary. */
export interface ManagerStats {
  tenants: ManagerTenantCounters;
  money: ManagerMoney;
}

export interface ManagerSummary {
  tenants: ManagerTenantCounters;
  paidThisMonth: number;
  ownerShareThisMonth: number;
  myShareThisMonth: number;
  paidTotal: number;
  ownerShareTotal: number;
  settledTotal: number;
  balance: number;
  ownerSharePercent: number;
  maxFreeDays: number;
}

export interface ManagerSettlement {
  id: string;
  managerId: string;
  amount: number;
  note: string | null;
  settledOn: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ManagerLedger {
  payments: Array<SubscriptionPaymentView & { tenantName: string }>;
  settlements: ManagerSettlement[];
  balance: number;
}

export interface PlatformManagerDetail extends PlatformManager {
  summary: ManagerSummary;
  tenants: TenantView[];
}

/** Internal platform CRM; never included in tenant/user/subscription responses. */
export interface PlatformTenantNote {
  id: string;
  tenantId: string;
  text: string;
  authorName: string | null;
  createdAt: string;
}

export interface PlatformTenantNotesPage {
  items: PlatformTenantNote[];
  total: number;
  nextContactAt: string | null;
}

export interface PlatformTenantFollowUp {
  nextContactAt: string | null;
}

/** Personal operator settings; push is opt-in (false by default). */
export interface PlatformReminderSettings {
  expiryEnabled: boolean;
  daysBefore: number[];
  pushEnabled: boolean;
}

interface PlatformReminderBase {
  id: string;
  tenantId: string;
  tenantName: string;
  dueAt: string;
  /** Calendar day difference in the tenant's timezone; overdue values are negative. */
  daysRemaining: number;
}

export type PlatformReminder =
  | (PlatformReminderBase & { kind: 'subscription_expiry'; subscriptionStatus: 'active' | 'expired' })
  | (PlatformReminderBase & { kind: 'follow_up' });

export interface PlatformReminderFeed {
  items: PlatformReminder[];
  generatedAt: string;
  /** Full matching count; items contains the first 200 ordered by urgency. */
  total: number;
}

export interface ManagerPlatformAnalytics {
  monthly: { month: string; paidRevenue: number; myShare: number; ownerShare: number }[];
}
