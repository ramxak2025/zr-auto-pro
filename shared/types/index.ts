// ═══════════════════════════════════════════════════════════════════════════════
//  Shared Types — used by both Web and Mobile apps
// ═══════════════════════════════════════════════════════════════════════════════

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  description?: string;
  features: string[];
  maxUsers: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  logo?: string;
  isActive: boolean;
  maxUsers: number;
  planId?: string;
  plan?: Plan;
  monthlyPrice: number;
  subscriptionEnd?: string | null;
  subscriptionNote?: string | null;
  legalName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  receiptFooter?: string;
  users?: User[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionInfo {
  tenantName: string;
  planName?: string | null;
  monthlyPrice: number;
  subscriptionEnd?: string | null;
  subscriptionNote?: string | null;
  maxUsers: number;
  currentUsers: number;
  plans: Plan[];
}

export interface PlatformStats {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
}

export interface User {
  id: string;
  username?: string;
  avatar?: string;
  phone: string;
  fullName: string;
  role: UserRole;
  salaryPercent: number;
  productSalaryPercent?: number;
  permissions: UserPermissions;
  daysOff?: number[];
  sortOrder?: number;
  isActive: boolean;
  /** Free-text team grouping. Null/empty → "Без группы" on the FE. */
  team?: string | null;
  /** Per-employee permission to submit /expenses entries. Off by default. */
  canAddExpenses?: boolean;
  /** When set, non-privileged users' daily expense submissions auto-flip to 'pending' once the total crosses this number. */
  dailyExpenseLimit?: number | null;
  /** 055 — hide from Schedule grid + attendance Rating (FE filters by context). */
  hiddenFromSchedule?: boolean;
  /** 055 — hide everywhere: lists + cannot be selected as master on a new check. */
  hiddenEverywhere?: boolean;
  tenantId?: string;
  tenant?: Tenant;
  createdAt: string;
}

export enum UserRole {
  SUPERADMIN = 'superadmin',
  DIRECTOR = 'director',
  ADMIN = 'admin',
  MASTER = 'master',
}

export interface UserPermissions {
  checks_view: boolean;
  checks_create: boolean;
  checks_edit: boolean;
  checks_delete: boolean;
  checks_change_datetime: boolean;
  profit_view: boolean;
  clients_view: boolean;
  clients_edit: boolean;
  warehouse_access: boolean;
  suppliers_access: boolean;
  financial_reports: boolean;
  export_data: boolean;
  user_management: boolean;
  schedule_view: boolean;
  salary_view: boolean;
  marketing_access: boolean;
}

export interface Client {
  id: string;
  fullName: string;
  phone: string;
  comment?: string;
  /** Acquisition source tag — value from `client_sources.sources` (e.g. "Яндекс", "Авито"). */
  source?: string | null;
  /** Owner-only free-form notes about the client. Capped at 4000 chars server-side. */
  ownerNotes?: string | null;
  /** True for the tenant's pinned "Розничный покупатель". */
  isRetail?: boolean;
  /** Last loyalty rating (1–5) from review_responses — DETAIL response only (#15). Null if никогда не оценивал. */
  lastRating?: number | null;
  /** Timestamp of that last rating — DETAIL response only. */
  lastRatingAt?: string | null;
  cars?: Car[];
  checks?: Check[];
  createdAt: string;
}

export interface Car {
  id: string;
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
  /** 059 — true for cars registered "без номера" (plateNumber is empty). */
  noPlate?: boolean;
  client?: Client;
  createdAt: string;
}

export interface BundleItem {
  productId: string;
  name: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: BundleItem[];
  supplierId?: string;
  supplier?: Supplier;
  /** Warehouse the product currently lives in. Null only for legacy rows that pre-date 028_warehouses.sql. */
  warehouseId: string | null;
  /** Default warranty period (in days) applied to lines that reference this product. Null = no warranty. */
  warrantyDays: number | null;
  /** EAN-13 / QR / custom barcode. Null if not set. */
  barcode?: string | null;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  category?: string;
  defaultPrice: number;
  /** Custom master commission percent (overrides user.salaryPercent when set) */
  masterPercent?: number | null;
  /** Default warranty period (in days) applied to lines that reference this service. Null = no warranty. */
  warrantyDays: number | null;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  tenantId: string;
  name: string;
  kind: 'main' | 'defect' | 'used';
  sortOrder: number;
}

export interface WarrantyClaim {
  id: string;
  tenantId: string;
  checkId: string;
  clientId?: string | null;
  carId?: string | null;
  kind: 'product' | 'service';
  productId?: string | null;
  serviceId?: string | null;
  itemName?: string | null;
  warrantyDays: number;
  startedAt: string;
  expiresAt: string;
  usedAt?: string | null;
  usedCheckId?: string | null;
  createdAt?: string;
}

export interface CheckServiceLine {
  id?: string;
  serviceId?: string;
  masterId?: string;
  master?: { id: string; fullName: string };
  name: string;
  price: number;
  quantity: number;
  total: number;
}

export interface CheckProductLine {
  id?: string;
  productId?: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  totalSell: number;
  totalCost: number;
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  WARRANTY = 'warranty',
  CASH_CARD = 'cash_card',
}

export interface Check {
  id: string;
  number: number;
  date: string;
  master?: User;
  masterId: string;
  client?: Client;
  clientId: string;
  car?: Car;
  carId: string;
  mileage?: number;
  services: CheckServiceLine[];
  products: CheckProductLine[];
  comment?: string;
  discount?: number;
  isDeferred?: boolean;
  paymentMethod: PaymentMethod;
  cashAmount: number;
  cardAmount: number;
  serviceTotal: number;
  productTotal: number;
  totalRevenue: number;
  productCostTotal: number;
  serviceSalaryTotal: number;
  productSalaryTotal?: number;
  totalCost: number;
  profit: number;
  /** Warranties spawned by this check (only populated by /checks/:id). */
  warrantyClaims?: WarrantyClaim[];
  /** Set when the check has been returned (full or partial). FE renders a strikethrough + badge in the journal. */
  isReturned?: boolean;
  returnedAt?: string | null;
  returnDestination?: 'warehouse' | 'defect' | null;
  returnScope?: 'full' | 'partial' | null;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
  totalPurchases: number;
  totalPaid: number;
  currentDebt: number;
  /** System-managed row — uneditable and undeletable. Currently used for the pinned "Покупка б/у товара" supplier. */
  isSystem?: boolean;
  /** Well-known marker. `'used_purchase'` is the inbound second-hand purchase channel; null for normal suppliers. */
  kind?: 'used_purchase' | null;
  createdAt: string;
}

export interface Delivery {
  id: string;
  supplierId: string;
  supplier?: Supplier;
  date: string;
  items: DeliveryItem[];
  totalAmount: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  comment?: string;
}

export interface DeliveryItem {
  id: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
  total: number;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  amount: number;
  date: string;
  comment?: string;
}

export type StockMovementType =
  | 'income'
  | 'expense'
  | 'writeoff'
  | 'inventory'
  | 'defect_transfer'
  | 'used_transfer'
  | 'defect_return_to_supplier';

export interface StockMovement {
  id: string;
  productId: string;
  product?: Product;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason?: string;
  userId?: string;
  user?: { id: string; fullName: string } | null;
  /** Warehouse the movement applies to (target on transfers). */
  warehouseId?: string | null;
  warehouseName?: string | null;
  sourceWarehouseId?: string | null;
  sourceWarehouseName?: string | null;
  targetWarehouseId?: string | null;
  targetWarehouseName?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  /** True when a writeoff also booked an `expenses` row. */
  recordAsExpense?: boolean;
  linkedExpenseId?: string | null;
  /** True when this movement is the inbound leg of a "Покупка б/у товара" — rendered specially in the journal. */
  isUsedPurchase?: boolean;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  /**
   * OPTIONAL keyset cursor for the NEXT page. Only present on endpoints that
   * support keyset pagination (currently the checks journal) AND only when the
   * caller requested it via a `cursor` param. `null` means end-of-feed.
   * Offset-only callers never see this field — it stays undefined.
   */
  nextCursor?: string | null;
}

export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  revenue: number;
  productCost: number;
  salaries: number;
  grossProfit: number;
  netProfit: number;
  checkCount: number;
}

export interface SalaryPayment {
  id: string;
  userId: string;
  userName?: string;
  amount: number;
  monthYear: string;
  type: 'salary' | 'advance' | 'premium';
  comment?: string;
  createdBy?: string;
  creatorName?: string;
  date: string;
  /** When the employee confirmed receipt (049_salary_payment_confirmations). Null until confirmed. */
  confirmedAt?: string | null;
  createdAt: string;
}

export interface MasterSalary {
  masterId: string;
  masterName: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  serviceEarnings?: number;
  productEarnings?: number;
  /** Sum of `type='cash'` premiums awarded inside the period (048_salary_premiums). */
  premiumsAmount?: number;
  /** Sum of penalties applied inside the period (056_salary_penalties). Subtracted from remainingAmount. */
  penaltiesAmount?: number;
  totalEarnings: number;
  totalRevenue: number;
  checkCount: number;
  paidAmount: number;
  /** totalEarnings − paidAmount − penaltiesAmount. */
  remainingAmount: number;
  payments?: SalaryPayment[];
  /** Premium rows awarded inside the period. */
  premiums?: SalaryPremium[];
  /** Penalty rows applied inside the period. */
  penalties?: SalaryPenalty[];
}

export interface ProductPromotion {
  productId: string;
  productName: string;
  percent: number;
  sellPrice: number;
  costPrice: number;
  photo?: string;
  estimatedBonus: number;
}

export interface SalarySummary {
  today: number;
  week: number;
  month: number;
  total: number;
  todayService?: number;
  todayProduct?: number;
  masterName: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  todayChecks?: number;
  monthChecks?: number;
  todayCash?: number;
  todayCard?: number;
  todayWarranty?: number;
  productPromotions?: ProductPromotion[];
}

export interface DashboardStats {
  todayRevenue: number;
  todayChecks: number;
  weekRevenue: number;
  monthRevenue: number;
  todayProfit: number;
  monthProfit: number;
}

export interface EmployeeRanking {
  today: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
  month: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
}

export interface Shift {
  id: string;
  tenantId: string;
  userId: string;
  user?: User;
  date: string;
  openedAt: string;
  closedAt?: string | null;
  isAutoClosed: boolean;
  note?: string;
}

export type LateStatus = 'on_time' | 'late_minor' | 'late_major';

export interface ScheduleEntry {
  id: string;
  tenantId: string;
  userId: string;
  user?: User;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  isDayOff: boolean;
  actualArrival?: string | null;
  lateMinutes: number;
  lateStatus?: LateStatus | null;
  note?: string;
  isManualOverride: boolean;
}

export interface WorkMode {
  id: string;
  tenantId: string;
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays: number[];
  shiftStart: string;
  shiftEnd: string;
}

export interface TodayEmployeeStatus {
  userId: string;
  fullName: string;
  role: string;
  isDayOff: boolean;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  actualArrival?: string | null;
  lateMinutes: number;
  lateStatus?: LateStatus | null;
  note?: string | null;
  isWorking: boolean;
  hasSchedule: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  tenantId: string;
  /** 057 — when true, non-privileged users' expenses in this category go to 'pending'. */
  approvalRequired?: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  categoryId?: string;
  categoryName?: string;
  amount: number;
  description?: string;
  date: string;
  userId?: string;
  userName?: string;
  /** User who entered the row (047_expenses_by_employee). */
  createdBy?: string;
  creatorName?: string;
  /** 'owner' for owner/director/admin-created, 'employee' for non-privileged submitters. */
  source?: 'owner' | 'employee';
  /** 'approved' (default), 'pending' (over limit), 'rejected'. */
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

export interface MarketingDashboard {
  totalReviews: number;
  avgRating: number;
  negativeReviews: number;
  positiveReviews: number;
  publicRedirects: number;
  tokensSent: number;
  tokensResponded: number;
  responseRate: number;
  conversionRate: number;
  unreadAlerts: number;
  employeeRatings: EmployeeReviewRating[];
}

export interface EmployeeReviewRating {
  employeeId: string;
  employeeName: string;
  reviewCount: number;
  avgRating: number;
  negativeRate: number;
}

export interface ReviewResponse {
  id: string;
  checkId?: string;
  clientId?: string;
  clientName?: string;
  employeeId?: string;
  employeeName?: string;
  rating: number;
  comment?: string;
  carMakeModel?: string;
  carPlate?: string;
  redirectedTo?: string;
  createdAt: string;
}

export interface ReviewAlert {
  id: string;
  alertType: 'consecutive_negative' | 'churn_risk';
  employeeName?: string;
  clientName?: string;
  details: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface MessagingIntegration {
  id: string;
  // Mirrors the messaging_integrations.provider_type CHECK constraint —
  // migration 008 already widened the DB to include smsru / moizvonki.
  // Anything outside this union will be rejected by the backend DTO.
  providerType: 'whatsapp' | 'sms' | 'smsru' | 'moizvonki' | 'email';
  senderName?: string;
  senderPhone?: string;
  webhookUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ReviewPlatformLink {
  id: string;
  // Avito joined the list (migration 054). When extending — sync the
  // DB CHECK constraint AND the IntegrationsScreen / web ReviewPublic
  // platform map at the same time.
  platform: 'google' | 'yandex' | '2gis' | 'avito';
  url: string;
  isActive: boolean;
}

export interface ReviewSettings {
  sendTime: string;
  feedbackDelayHours: number;
  autoSendEnabled: boolean;
  messageTemplate: string;
  // "Подарок за отзыв" — single sentence the owner promises to clients
  // who leave honest reviews. Surfaced on the public landing page and
  // via the `{motivation}` variable in message templates.
  motivationMessage: string;
}

export interface PublicReviewData {
  tenantName: string;
  clientName?: string;
  employeeName?: string;
  platformLinks: ReviewPlatformLink[];
  // Optional — empty string when the tenant hasn't set anything.
  motivationMessage?: string;
}

export interface CheckPhoto {
  id: string;
  checkId: string;
  photoUrl: string;
  createdAt: string;
  createdBy: string;
}

export interface CheckTemplate {
  id: string;
  name: string;
  services: Array<{ serviceId?: string; name: string; price: number; quantity: number }>;
  products: Array<{ productId?: string; name: string; sellPrice: number; costPrice: number; quantity: number }>;
  createdAt: string;
}

export interface PushToken {
  token: string;
  platform: 'ios' | 'android';
}

export interface CallFunnel {
  totalCalls: number;
  uniqueCallers: number;
  arrivedClients: number;
  createdChecks: number;
  totalRevenue: number;
  avgCheckValue: number;
  repeatClients: number;
  conversionRate: number;
  period: { from: string; to: string };
}

export interface ReminderSettings {
  enabled: boolean;
  monthsInterval: number;
  messageTemplate: string;
  lastRunAt?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Returns
// ───────────────────────────────────────────────────────────────────────

export interface CheckReturn {
  id: string;
  checkId: string;
  destination: 'warehouse' | 'defect';
  reason?: string | null;
  refundAmount: number;
  scope: 'full' | 'partial';
  returnedBy?: string | null;
  createdAt: string;
  /** Joined from checks for journal display. */
  checkNumber?: number;
  checkTotal?: number;
  clientName?: string | null;
}

// ───────────────────────────────────────────────────────────────────────
//  Schedule settings (which attendance statuses count as a real shift)
// ───────────────────────────────────────────────────────────────────────

export interface ScheduleSettings {
  /**
   * Subset of allowed statuses: 'worked' | 'dayoff' | 'sick' | 'short' |
   * 'long' | 'absent'. Defaults to ['worked', 'short'].
   */
  shiftStatuses: string[];
}

// ───────────────────────────────────────────────────────────────────────
//  Employee profile / achievements / full profile composite
// ───────────────────────────────────────────────────────────────────────

export interface EmployeeProfile {
  id: string;
  fullName: string;
  role: string;
  hireDate?: string | null;
  specializations: string[];
  positionTitle?: string | null;
  customTitle?: string | null;
  monthlyKpiRevenue?: number | null;
  monthlyKpiChecks?: number | null;
  ownerNotes?: string | null;
  photoUrl?: string | null;
  whatsapp?: string | null;
}

export interface EmployeeDocument {
  id: string;
  type: string;
  name?: string | null;
  fileUrl: string;
  uploadedAt: string;
  expiresAt?: string | null;
}

export interface EmployeeAchievement {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  type: 'auto' | 'custom';
  awardedBy?: string | null;
  awardedAt: string;
}

export interface EmployeeFullProfile {
  profile: EmployeeProfile;
  stats: {
    efficiency: number;
    discipline: number;
    activity: number;
    rating: number;
    quality: number;
  };
  streaks: {
    disciplineStreak: number;
    fiveStarStreak: number;
    checksStreak: number;
  };
  lifetime: {
    totalChecks: number;
    totalRevenue: number;
    clientsServed: number;
    bestDay?: { date: string; value: number };
    bestMonth?: { ym: string; value: number };
    topCarBrands: { brand: string; count: number }[];
  };
  yearHeatmap: { day: string; checks: number; revenue: number }[];
  teamRank: {
    revenueRank: number;
    disciplineRank: number;
    ratingRank: number;
    total: number;
  };
  serviceMastery: {
    serviceId: string;
    name: string;
    count: number;
    tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  }[];
  careerTimeline: {
    date: string;
    kind: 'hire' | 'promotion' | 'top_month' | 'custom';
    title: string;
    description?: string;
  }[];
  achievements: EmployeeAchievement[];
}

// ───────────────────────────────────────────────────────────────────────
//  Owner dashboard v2 + supporting analytics
// ───────────────────────────────────────────────────────────────────────

export interface DashboardV2 {
  revenueToday: number;
  revenueMonth: number;
  checksToday: number;
  netProfitToday: number;
  netProfitMonth: number;
  cashPosition: { cash: number; card: number; warranty: number; total: number };
  marginPct: number;
  marginPctChange: number;
  marginSpark: number[];
  deferredSum: { count: number; sum: number };
  personalRecord: {
    bestDay?: { date: string; value: number };
    bestMonth?: { ym: string; value: number };
  };
  monthForecast: number;
  /** Returns recorded today (count + total refund amount). */
  returnsToday: number;
  returnsAmount: number;
  period: 'today' | 'week' | 'month' | 'year';
}

export interface ClientsNewVsReturning {
  newCount: number;
  returningCount: number;
  newRevenue: number;
  returningRevenue: number;
  period: { from: string; to: string };
}

export interface OwnerAlert {
  type: 'low_stock' | 'low_review' | 'warranty' | 'late_master' | 'pending_return';
  severity: 'info' | 'warn' | 'crit';
  message: string;
  link?: string;
}

export interface BestDayOfWeek {
  days: { weekday: number; revenue: number; count: number }[];
  best: number;
  worst: number;
}

export interface RecentReview {
  id: string;
  rating: number;
  comment?: string | null;
  clientName?: string | null;
  employeeName?: string | null;
  createdAt: string;
}

export interface RetentionStats {
  returningRate: number;
  avgLtv: number;
  avgDaysBetweenVisits: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Warehouse analytics (045_stock_value_snapshots + computed endpoints)
// ───────────────────────────────────────────────────────────────────────

export interface WarehouseSummary {
  stockValueStart: number;
  stockValueCurrent: number;
  stockValueDelta: number;
  deltaPct: number;
  itemsCount: number;
  deadStock30: { count: number; value: number };
  deadStock60: { count: number; value: number };
  deadStock90: { count: number; value: number };
  abcAnalysis: { tier: 'A' | 'B' | 'C'; count: number; value: number; pct: number }[];
  avgMargin: number;
  gmroi: number;
  overStocked: { id: string; name: string; stock: number; sales: number }[];
  understocked: { id: string; name: string; stock: number; sales: number }[];
}

export interface VelocityRow {
  productId: string;
  name: string;
  soldQty: number;
  avgDailySales: number;
  currentStock: number;
  daysOfStock: number;
}

export interface ReorderItem {
  productId: string;
  name: string;
  currentStock: number;
  avgDailySales: number;
  daysOfStock: number;
  urgency: 'critical' | 'now' | 'soon' | 'overstocked';
  recommendedOrderQty: number;
}

export interface CategoryMargin {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  soldQty: number;
  revenue: number;
  profit: number;
}

// ───────────────────────────────────────────────────────────────────────
//  Active warranties (cash screen helper)
// ───────────────────────────────────────────────────────────────────────

export interface ActiveWarranty {
  kind: 'product' | 'service';
  name: string;
  expiresAt: string;
  daysLeft: number;
}

/**
 * Active warranty for a single car — badge-ready shape returned by
 * `GET /warranty-claims/active-for-car/:carId` (warrantyApi.activeForCar).
 * Drives the "Диагностика ещё N дней" chips on the CheckCreate screen.
 */
export interface WarrantyActive {
  id: string;
  itemType: 'product' | 'service';
  itemName: string;
  warrantyDays: number;
  expiresAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Client sources (046_clients_source) and per-car checks (052)
// ───────────────────────────────────────────────────────────────────────

export interface ClientSources {
  sources: string[];
}

export interface PerCarChecks {
  carId: string;
  carPlate?: string;
  makeModel?: string;
  checks: Array<{
    id: string;
    number: number;
    date: string;
    totalRevenue: number;
    paymentMethod?: string;
    masterName?: string | null;
    carPlate?: string | null;
    carMakeModel?: string | null;
    isReturned?: boolean;
    isDeferred?: boolean;
  }>;
}

// ───────────────────────────────────────────────────────────────────────
//  Salary premiums (048_salary_premiums)
// ───────────────────────────────────────────────────────────────────────

export interface SalaryPremium {
  id: string;
  userId: string;
  userName?: string;
  type: 'cash' | 'rate_bonus';
  amount?: number;
  bonusPercent?: number;
  reason: string;
  periodMonthYear?: string;
  awardedBy?: string;
  awarderName?: string;
  awardedAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Salary penalties (штрафы, 056_salary_penalties)
// ───────────────────────────────────────────────────────────────────────

export interface SalaryPenalty {
  id: string;
  userId: string;
  userName?: string;
  /** Positive deduction amount (RUB). Subtracted from the employee's remaining owed salary. */
  amount: number;
  description?: string;
  /** When the penalty applies. */
  date: string;
  createdBy?: string;
  creatorName?: string;
  createdAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//  Journal / warehouse documents (050_journal_warehouse_docs_index)
// ───────────────────────────────────────────────────────────────────────

export interface JournalDoc {
  id: string;
  kind: 'purchase' | 'return_to_supplier' | 'defect_transfer' | 'writeoff' | 'supplier_payment' | 'used_purchase';
  occurredAt: string;
  title: string;
  subtitle?: string;
  amount: number;
  badge: string;
  badgeColor: string;
  payeeName?: string;
}
