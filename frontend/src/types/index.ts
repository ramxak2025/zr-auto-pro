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
  permissions: UserPermissions;
  daysOff?: number[];
  isActive: boolean;
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
  profit_view: boolean;
  clients_view: boolean;
  clients_edit: boolean;
  warehouse_access: boolean;
  suppliers_access: boolean;
  financial_reports: boolean;
  export_data: boolean;
  user_management: boolean;
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
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  category?: string;
  defaultPrice: number;
  createdAt: string;
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
  totalCost: number;
  profit: number;
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

export interface StockMovement {
  id: string;
  productId: string;
  product?: Product;
  type: 'income' | 'expense' | 'writeoff' | 'inventory';
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason?: string;
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

export interface MasterSalary {
  masterId: string;
  masterName: string;
  salaryPercent: number;
  totalEarnings: number;
  totalRevenue: number;
  checkCount: number;
}

export interface SalarySummary {
  today: number;
  week: number;
  month: number;
  total: number;
  masterName: string;
  salaryPercent: number;
  todayChecks?: number;
  monthChecks?: number;
  todayCash?: number;
  todayCard?: number;
  todayWarranty?: number;
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

// ─── Marketing / Reputation Management ────────────────────────────

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
  clientName?: string;
  employeeName?: string;
  rating: number;
  comment?: string;
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
