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
  type: 'salary' | 'advance';
  comment?: string;
  createdBy?: string;
  creatorName?: string;
  date: string;
  createdAt: string;
}

export interface MasterSalary {
  masterId: string;
  masterName: string;
  salaryPercent: number;
  productSalaryPercent?: number;
  serviceEarnings?: number;
  productEarnings?: number;
  totalEarnings: number;
  totalRevenue: number;
  checkCount: number;
  paidAmount: number;
  remainingAmount: number;
  payments?: SalaryPayment[];
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
  providerType: 'whatsapp' | 'sms' | 'email';
  senderName?: string;
  senderPhone?: string;
  webhookUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ReviewPlatformLink {
  id: string;
  platform: 'google' | 'yandex' | '2gis';
  url: string;
  isActive: boolean;
}

export interface ReviewSettings {
  sendTime: string;
  feedbackDelayHours: number;
  autoSendEnabled: boolean;
  messageTemplate: string;
}

export interface PublicReviewData {
  tenantName: string;
  clientName?: string;
  employeeName?: string;
  platformLinks: ReviewPlatformLink[];
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
