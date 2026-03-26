// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Service Factories
//  Each factory accepts an AxiosInstance and returns the API module.
//  Platform-specific code (file upload, image compression) is NOT here.
// ═══════════════════════════════════════════════════════════════════════════════

import type { AxiosInstance } from 'axios';
import type {
  User, Tenant, Plan, Client, Car, Product, Service, Check, Supplier,
  Delivery, SupplierPayment, MasterSalary, SalarySummary, SalaryPayment,
  FinancialReport, DashboardStats, EmployeeRanking, Shift, ScheduleEntry,
  WorkMode, StockMovement, PaginatedResponse, SubscriptionInfo, PlatformStats,
  TodayEmployeeStatus, MarketingDashboard, ReviewResponse, ReviewAlert,
  MessagingIntegration, ReviewPlatformLink, ReviewSettings, PublicReviewData,
} from '../types';
import type {
  LoginRequest, LoginResponse, RegisterRequest, PaginationParams, ChecksParams,
  DateRangeParams, CashFlowParams, CreateUserRequest, UpdateUserRequest, CreateClientRequest,
  UpdateClientRequest, CreateCarRequest, UpdateCarRequest, CreateProductRequest,
  UpdateProductRequest, StockUpdateRequest, CreateServiceRequest, UpdateServiceRequest,
  CreateCheckRequest, UpdateCheckRequest, CreateSupplierRequest, UpdateSupplierRequest,
  CreateDeliveryRequest, CreatePaymentRequest, CreateScheduleRequest, UpdateScheduleRequest,
  CreateWorkModeRequest, UpdateWorkModeRequest, CreateTenantRequest, UpdateTenantRequest,
  CreatePlanRequest, UpdatePlanRequest,
} from './types';

export function createAuthApi(api: AxiosInstance) {
  return {
    login: (data: LoginRequest) => api.post<LoginResponse>('/auth/login', data),
    register: (data: RegisterRequest) => api.post<LoginResponse>('/auth/register', data),
    me: () => api.get<User>('/auth/me'),
    updateAvatar: (avatar: string) => api.patch<{ avatar: string }>('/auth/avatar', { avatar }),
  };
}

export function createUsersApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<User[]>('/users', { params }),
    getMasters: (params?: PaginationParams) => api.get<User[]>('/users/masters', { params }),
    getById: (id: string) => api.get<User>(`/users/${id}`),
    create: (data: CreateUserRequest) => api.post<User>('/users', data),
    update: (id: string, data: UpdateUserRequest) => api.patch<User>(`/users/${id}`, data),
    remove: (id: string) => api.delete(`/users/${id}`),
    getProductCommissions: (id: string) => api.get(`/users/${id}/product-commissions`),
    setProductCommissions: (id: string, data: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> }) =>
      api.post(`/users/${id}/product-commissions`, data),
  };
}

export function createTenantsApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Tenant[]>('/tenants'),
    getStats: () => api.get<PlatformStats>('/tenants/stats'),
    getById: (id: string) => api.get<Tenant>(`/tenants/${id}`),
    create: (data: CreateTenantRequest) => api.post<Tenant>('/tenants', data),
    update: (id: string, data: UpdateTenantRequest) => api.patch<Tenant>(`/tenants/${id}`, data),
    remove: (id: string) => api.delete(`/tenants/${id}`),
  };
}

export function createMyCompanyApi(api: AxiosInstance) {
  return {
    get: () => api.get<Tenant>('/my-company'),
    update: (data: Partial<Tenant>) => api.patch<Tenant>('/my-company', data),
  };
}

export function createPlansApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Plan[]>('/plans'),
    create: (data: CreatePlanRequest) => api.post<Plan>('/plans', data),
    update: (id: string, data: UpdatePlanRequest) => api.patch<Plan>(`/plans/${id}`, data),
    remove: (id: string) => api.delete(`/plans/${id}`),
  };
}

export function createSubscriptionApi(api: AxiosInstance) {
  return {
    get: () => api.get<SubscriptionInfo>('/subscription'),
  };
}

export function createClientsApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Client>>('/clients', { params }),
    getById: (id: string) => api.get<Client>(`/clients/${id}`),
    create: (data: CreateClientRequest) => api.post<Client>('/clients', data),
    update: (id: string, data: UpdateClientRequest) => api.patch<Client>(`/clients/${id}`, data),
    remove: (id: string) => api.delete(`/clients/${id}`),
    exportCsv: () => api.get('/clients/export-csv', { responseType: 'blob' }),
  };
}

export function createCarsApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Car>>('/cars', { params }),
    getById: (id: string) => api.get<Car>(`/cars/${id}`),
    create: (data: CreateCarRequest) => api.post<Car>('/cars', data),
    update: (id: string, data: UpdateCarRequest) => api.patch<Car>(`/cars/${id}`, data),
    remove: (id: string) => api.delete(`/cars/${id}`),
  };
}

export function createProductsApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Product>>('/products', { params }),
    getLowStock: () => api.get<Product[]>('/products/low-stock'),
    getMovements: (params?: PaginationParams) => api.get<StockMovement[]>('/products/movements', { params }),
    getWarehouseStats: () => api.get<{ totalCostValue: number; totalSellValue: number; totalItems: number; monthProductCost: number; lastMonthProductCost: number }>('/products/warehouse-stats'),
    getById: (id: string) => api.get<Product>(`/products/${id}`),
    create: (data: CreateProductRequest) => api.post<Product>('/products', data),
    update: (id: string, data: UpdateProductRequest) => api.patch<Product>(`/products/${id}`, data),
    remove: (id: string) => api.delete(`/products/${id}`),
    updateStock: (id: string, data: StockUpdateRequest) => api.post<{ stock: number }>(`/products/${id}/stock`, data),
    exportCsv: () => api.get('/products/export-csv', { responseType: 'blob' }),
    importCsv: (items: Array<{ name: string; category?: string; costPrice?: number; sellPrice?: number; stock?: number; minStock?: number; unit?: string }>) =>
      api.post<{ created: number; updated: number; total: number }>('/products/import-csv', { items }),
  };
}

export function createServicesApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams & { category?: string }) => api.get<PaginatedResponse<Service>>('/services', { params }),
    getById: (id: string) => api.get<Service>(`/services/${id}`),
    create: (data: CreateServiceRequest) => api.post<Service>('/services', data),
    update: (id: string, data: UpdateServiceRequest) => api.patch<Service>(`/services/${id}`, data),
    remove: (id: string) => api.delete(`/services/${id}`),
  };
}

export function createChecksApi(api: AxiosInstance) {
  return {
    getAll: (params?: ChecksParams) => api.get<PaginatedResponse<Check>>('/checks', { params }),
    getDashboard: () => api.get<DashboardStats>('/checks/dashboard'),
    getDashboardChart: (period: string, offset?: number) => api.get<{ points: Array<{ date: string; revenue: number; profit: number; checkCount: number }>; totalRevenue: number; totalProfit: number; totalChecks: number }>('/checks/dashboard/chart', { params: { period, offset: offset ?? 0 } }),
    getRanking: () => api.get<EmployeeRanking>('/checks/ranking'),
    getById: (id: string) => api.get<Check>(`/checks/${id}`),
    create: (data: CreateCheckRequest) => api.post<Check>('/checks', data),
    update: (id: string, data: UpdateCheckRequest) => api.patch<Check>(`/checks/${id}`, data),
    remove: (id: string) => api.delete(`/checks/${id}`),
  };
}

export function createSuppliersApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Supplier>>('/suppliers', { params }),
    getById: (id: string) => api.get<Supplier>(`/suppliers/${id}`),
    create: (data: CreateSupplierRequest) => api.post<Supplier>('/suppliers', data),
    update: (id: string, data: UpdateSupplierRequest) => api.patch<Supplier>(`/suppliers/${id}`, data),
    remove: (id: string) => api.delete(`/suppliers/${id}`),
    getDeliveries: (params?: { supplierId?: string }) => api.get<Delivery[]>('/suppliers/deliveries', { params }),
    createDelivery: (data: CreateDeliveryRequest) => api.post<{ id: string }>('/suppliers/deliveries', data),
    getDeliveryById: (id: string) => api.get<Delivery>(`/suppliers/deliveries/${id}`),
    getPayments: (params?: { supplierId?: string }) => api.get<SupplierPayment[]>('/suppliers/payments', { params }),
    createPayment: (data: CreatePaymentRequest) => api.post<{ id: string }>('/suppliers/payments', data),
  };
}

export function createSalaryApi(api: AxiosInstance) {
  return {
    getAll: (params?: DateRangeParams) => api.get<MasterSalary[]>('/salary', { params }),
    getMy: () => api.get<SalarySummary>('/salary/my'),
    getPayments: (params?: { userId?: string; monthYear?: string }) => api.get<SalaryPayment[]>('/salary/payments', { params }),
    createPayment: (data: { userId: string; amount: number; monthYear: string; type: 'salary' | 'advance'; comment?: string }) => api.post<SalaryPayment>('/salary/payments', data),
  };
}

export function createReportsApi(api: AxiosInstance) {
  return {
    getFinancial: (params: DateRangeParams) => api.get<FinancialReport>('/reports/financial', { params }),
    getCashFlow: (params: CashFlowParams) => api.get<{ days: Array<{ date: string; cash: number; card: number; warranty: number; total: number }>; totals: { cash: number; card: number; warranty: number; total: number } }>('/reports/cashflow', { params }),
  };
}

export function createShiftsApi(api: AxiosInstance) {
  return {
    getAll: (params?: PaginationParams) => api.get<Shift[]>('/shifts', { params }),
    getMy: () => api.get<Shift[]>('/shifts/my'),
    open: (data?: Record<string, unknown>) => api.post<Shift>('/shifts/open', data),
    close: (id: string) => api.post<Shift>(`/shifts/${id}/close`),
  };
}

export function createScheduleApi(api: AxiosInstance) {
  return {
    getAll: (params: DateRangeParams) => api.get<ScheduleEntry[]>('/schedule', { params }),
    create: (data: CreateScheduleRequest) => api.post<ScheduleEntry>('/schedule', data),
    update: (id: string, data: UpdateScheduleRequest) => api.patch('/schedule/' + id, data),
    remove: (id: string) => api.delete(`/schedule/${id}`),
    getWorkModes: () => api.get<WorkMode[]>('/schedule/work-modes'),
    createWorkMode: (data: CreateWorkModeRequest) => api.post<WorkMode>('/schedule/work-modes', data),
    updateWorkMode: (id: string, data: UpdateWorkModeRequest) => api.patch(`/schedule/work-modes/${id}`, data),
    applyWorkMode: (data: { workModeId: string; userId?: string; dateFrom: string; dateTo: string }) => api.post<{ created: number }>('/schedule/apply-work-mode', data),
    getToday: () => api.get<TodayEmployeeStatus[]>('/schedule/today'),
    getMyStats: () => api.get<{ totalScheduled: number; totalWorked: number; totalLate: number; totalLateMinor: number; totalLateMajor: number; totalOnTime: number; totalDaysOff: number; avgLateMinutes: number }>('/schedule/my-stats'),
  };
}

export function createExpensesApi(api: AxiosInstance) {
  return {
    getCategories: () => api.get<Array<{ id: string; name: string }>>('/expenses/categories'),
    createCategory: (data: { name: string }) => api.post('/expenses/categories', data),
    removeCategory: (id: string) => api.delete(`/expenses/categories/${id}`),
    getAll: (params?: DateRangeParams) => api.get<Array<{ id: string; categoryId?: string; categoryName?: string; amount: number; description?: string; date: string; userId?: string; userName?: string; createdAt: string }>>('/expenses', { params }),
    create: (data: { categoryId?: string; amount: number; description?: string; date?: string }) => api.post('/expenses', data),
    remove: (id: string) => api.delete(`/expenses/${id}`),
  };
}

export function createWarehouseCategoriesApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Array<{ id: string; path: string }>>('/warehouse/categories'),
    create: (path: string) => api.post<{ id: string; path: string }>('/warehouse/categories', { path }),
    remove: (id: string) => api.delete(`/warehouse/categories/${id}`),
  };
}

export function createMarketingApi(api: AxiosInstance) {
  return {
    getDashboard: () => api.get<MarketingDashboard>('/marketing/dashboard'),
    getReviews: (params?: { employeeId?: string; minRating?: number; maxRating?: number; month?: string }) => api.get<ReviewResponse[]>('/marketing/reviews', { params }),
    getAlerts: () => api.get<ReviewAlert[]>('/marketing/alerts'),
    markAlertRead: (id: string) => api.patch(`/marketing/alerts/${id}/read`),
    getIntegrations: () => api.get<MessagingIntegration[]>('/marketing/integrations'),
    upsertIntegration: (data: { id?: string; providerType: string; apiKey: string; senderName?: string; senderPhone?: string; webhookUrl?: string; isActive?: boolean }) => api.post<MessagingIntegration[]>('/marketing/integrations', data),
    removeIntegration: (id: string) => api.delete(`/marketing/integrations/${id}`),
    getPlatformLinks: () => api.get<ReviewPlatformLink[]>('/marketing/platform-links'),
    upsertPlatformLink: (data: { platform: string; url: string; isActive?: boolean }) => api.post<ReviewPlatformLink[]>('/marketing/platform-links', data),
    removePlatformLink: (id: string) => api.delete(`/marketing/platform-links/${id}`),
    getSettings: () => api.get<ReviewSettings>('/marketing/settings'),
    updateSettings: (data: Partial<ReviewSettings>) => api.patch<ReviewSettings>('/marketing/settings', data),
    testIntegration: (id: string) => api.post(`/marketing/integrations/${id}/test`),
    sendSms: (data: { clientId: string; phone: string; message: string }) => api.post('/marketing/sms/send', data),
  };
}

export function createPublicReviewApi(api: AxiosInstance) {
  return {
    getByToken: (token: string) => api.get<PublicReviewData>(`/marketing/review/${token}`),
    submit: (token: string, data: { rating: number; comment?: string; redirectedTo?: string }) => api.post<{ success: boolean }>(`/marketing/review/${token}`, data),
  };
}

export function createCallsApi(api: AxiosInstance) {
  return {
    getCalls: (params: { date?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; summary: { total: number; incoming: number; outgoing: number; missed: number; notCalledBack: number } }>('/calls', { params }),
    getClientCalls: (clientId: string, params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; total: number }>(`/calls/client/${clientId}`, { params }),
    getClientSms: (clientId: string) =>
      api.get<any[]>(`/calls/client/${clientId}/sms`),
    getClientSmsHistory: (clientId: string) =>
      api.get<any[]>(`/calls/client/${clientId}/sms`),
    getRecordingUrl: (url: string) =>
      api.get<{ url: string }>('/calls/recording', { params: { url } }),
  };
}
