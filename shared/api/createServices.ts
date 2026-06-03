// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Service Factories
//  Each factory accepts an HTTP client (axios-shaped) and returns the API module.
//  Platform-specific code (file upload, image compression) is NOT here.
//
//  HttpClient структурно совместим с этим интерфейсом — потребитель
//  (mobile/frontend) передаёт настроенный axios. shared не зависит от axios
//  как пакета, поэтому конфликта типов между mobile/node_modules/axios и
//  shared/node_modules/axios больше нет — последнего просто не существует.
// ═══════════════════════════════════════════════════════════════════════════════

interface HttpClient {
  get<T = any>(url: string, config?: unknown): Promise<{ data: T }>;
  post<T = any>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
  put<T = any>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
  patch<T = any>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
  delete<T = any>(url: string, config?: unknown): Promise<{ data: T }>;
}
import type {
  User, Tenant, Plan, Client, Car, Product, Service, Check, Supplier,
  Delivery, SupplierPayment, MasterSalary, SalarySummary, SalaryPayment,
  FinancialReport, DashboardStats, EmployeeRanking, Shift, ScheduleEntry,
  WorkMode, StockMovement, PaginatedResponse, SubscriptionInfo, PlatformStats,
  TodayEmployeeStatus, MarketingDashboard, ReviewResponse, ReviewAlert,
  MessagingIntegration, ReviewPlatformLink, ReviewSettings, PublicReviewData,
  Warehouse, WarrantyClaim, CheckPhoto, CheckTemplate, CallFunnel, ReminderSettings,
  CheckReturn, ScheduleSettings, EmployeeProfile, EmployeeDocument,
  EmployeeAchievement, EmployeeFullProfile, DashboardV2, ClientsNewVsReturning,
  OwnerAlert, BestDayOfWeek, RecentReview, RetentionStats,
  WarehouseSummary, VelocityRow, ReorderItem, CategoryMargin, TopProduct,
  ActiveWarranty, WarrantyActive, ClientSources, PerCarChecks, SalaryPremium, SalaryPenalty,
  ExpenseCategory, JournalDoc,
} from '../types';
import type {
  LoginRequest, LoginResponse, RegisterRequest, PaginationParams, ChecksParams, CarsQuery,
  DateRangeParams, CashFlowParams, CreateUserRequest, UpdateUserRequest, CreateClientRequest,
  UpdateClientRequest, CreateCarRequest, UpdateCarRequest, CreateProductRequest,
  UpdateProductRequest, StockUpdateRequest, CreateServiceRequest, UpdateServiceRequest,
  CreateCheckRequest, UpdateCheckRequest, CreateSupplierRequest, UpdateSupplierRequest,
  CreateDeliveryRequest, CreatePaymentRequest, CreateScheduleRequest, UpdateScheduleRequest,
  CreateWorkModeRequest, UpdateWorkModeRequest, CreateTenantRequest, UpdateTenantRequest,
  CreatePlanRequest, UpdatePlanRequest,
  ImportPreviewRequest, ImportPreviewResponse, ImportConfirmRequest, ImportConfirmResponse,
} from './types';

export function createAuthApi(api: HttpClient) {
  return {
    login: (data: LoginRequest) => api.post<LoginResponse>('/auth/login', data),
    register: (data: RegisterRequest) => api.post<LoginResponse>('/auth/register', data),
    me: () => api.get<User>('/auth/me'),
    logout: () => api.post('/auth/logout'),
    updateAvatar: (avatar: string) => api.patch<{ avatar: string }>('/auth/avatar', { avatar }),
  };
}

export function createUsersApi(api: HttpClient) {
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
    updateOrder: (orderedIds: string[]) => api.post('/users/order', { orderedIds }),
  };
}

export function createTenantsApi(api: HttpClient) {
  return {
    getAll: () => api.get<Tenant[]>('/tenants'),
    getStats: () => api.get<PlatformStats>('/tenants/stats'),
    getById: (id: string) => api.get<Tenant>(`/tenants/${id}`),
    create: (data: CreateTenantRequest) => api.post<Tenant>('/tenants', data),
    update: (id: string, data: UpdateTenantRequest) => api.patch<Tenant>(`/tenants/${id}`, data),
    remove: (id: string) => api.delete(`/tenants/${id}`),
  };
}

export function createMyCompanyApi(api: HttpClient) {
  return {
    get: () => api.get<Tenant>('/my-company'),
    update: (data: Partial<Tenant>) => api.patch<Tenant>('/my-company', data),
  };
}

export function createPlansApi(api: HttpClient) {
  return {
    getAll: () => api.get<Plan[]>('/plans'),
    create: (data: CreatePlanRequest) => api.post<Plan>('/plans', data),
    update: (id: string, data: UpdatePlanRequest) => api.patch<Plan>(`/plans/${id}`, data),
    remove: (id: string) => api.delete(`/plans/${id}`),
  };
}

export function createSubscriptionApi(api: HttpClient) {
  return {
    get: () => api.get<SubscriptionInfo>('/subscription'),
  };
}

export function createClientsApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Client>>('/clients', { params }),
    getById: (id: string) => api.get<Client>(`/clients/${id}`),
    create: (data: CreateClientRequest) => api.post<Client>('/clients', data),
    update: (id: string, data: UpdateClientRequest) => api.patch<Client>(`/clients/${id}`, data),
    remove: (id: string) => api.delete(`/clients/${id}`),
    exportCsv: () => api.get('/clients/export-csv', { responseType: 'blob' }),
    /** Update just the source tag (faster path than full client update). */
    updateSource: (id: string, source: string | null) =>
      api.patch<Client>(`/clients/${id}/source`, { source }),
    /** Update just the owner notes. */
    updateNotes: (id: string, notes: string | null) =>
      api.patch<Client>(`/clients/${id}/notes`, { notes }),
    /** Client's checks grouped by car. */
    checksByCar: (id: string) => api.get<PerCarChecks[]>(`/clients/${id}/checks-by-car`),
    /** Returns existing client with the given phone in the current tenant, or null. */
    lookupByPhone: (phone: string) =>
      api.get<{
        id: string;
        fullName: string;
        phone: string;
        createdAt: string;
        cars: Array<{ id: string; plateNumber: string; makeModel: string }>;
      } | null>('/clients/lookup-by-phone', { params: { phone } }),
  };
}

export function createCarsApi(api: HttpClient) {
  return {
    getAll: (params?: CarsQuery) => {
      // Thread the «без номеров» flag through as a query param only when set, so
      // existing callers (no noPlate) keep the exact same request shape.
      const query: CarsQuery = { ...params };
      if (params?.noPlate) query.noPlate = true;
      else delete query.noPlate;
      return api.get<PaginatedResponse<Car>>('/cars', { params: query });
    },
    getById: (id: string) => api.get<Car>(`/cars/${id}`),
    create: (data: CreateCarRequest) => api.post<Car>('/cars', data),
    update: (id: string, data: UpdateCarRequest) => api.patch<Car>(`/cars/${id}`, data),
    remove: (id: string) => api.delete(`/cars/${id}`),
    /** Recent checks for one car. limit capped at 200 server-side. */
    checks: (carId: string, params?: { limit?: number }) =>
      api.get<Check[]>(`/cars/${carId}/checks`, { params }),
    /** Returns existing car with the given plate (normalized) in the current tenant, or null. */
    lookupByPlate: (plate: string) =>
      api.get<{
        id: string;
        plateNumber: string;
        makeModel: string;
        clientId: string | null;
        createdAt: string;
        client: { id: string; fullName: string; phone: string } | null;
      } | null>('/cars/lookup-by-plate', { params: { plate } }),
  };
}

export function createProductsApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams & { warehouseId?: string }) => api.get<PaginatedResponse<Product>>('/products', { params }),
    getLowStock: () => api.get<Product[]>('/products/low-stock'),
    getMovements: (params?: PaginationParams) => api.get<StockMovement[]>('/products/movements', { params }),
    getWarehouseStats: () => api.get<{ totalCostValue: number; totalSellValue: number; totalItems: number; monthProductCost: number; lastMonthProductCost: number }>('/products/warehouse-stats'),
    getById: (id: string) => api.get<Product>(`/products/${id}`),
    create: (data: CreateProductRequest) => api.post<Product>('/products', data),
    update: (id: string, data: UpdateProductRequest) => api.patch<Product>(`/products/${id}`, data),
    /** Set just the sell price on an existing product. */
    setSellPrice: (id: string, sellPrice: number) =>
      api.patch<Product>(`/products/${id}/sell-price`, { sellPrice }),
    remove: (id: string) => api.delete(`/products/${id}`),
    // ── Trash bin ─────────────────────────────────────────────────────
    // Soft-deleted products live in the trash. They stay searchable here
    // until restored or hard-deleted; check history is unaffected because
    // check_product_lines stores a snapshot of name/prices.
    getTrash: () => api.get<Product[]>('/products/trash'),
    restore: (id: string) => api.post<{ message: string }>(`/products/${id}/restore`),
    hardDelete: (id: string) => api.delete<{ message: string }>(`/products/${id}/hard`),
    emptyTrash: () => api.delete<{ message: string; count: number }>('/products/trash/empty'),
    updateStock: (id: string, data: StockUpdateRequest) => api.post<{ stock: number }>(`/products/${id}/stock`, data),
    getProductMovements: (id: string) => api.get<any[]>(`/products/${id}/movements`),
    getProductPriceHistory: (id: string) => api.get<any[]>(`/products/${id}/price-history`),
    exportCsv: () => api.get('/products/export-csv', { responseType: 'blob' }),
    importCsv: (items: Array<{ name: string; category?: string; costPrice?: number; sellPrice?: number; stock?: number; minStock?: number; unit?: string }>) =>
      api.post<{ created: number; updated: number; skipped?: number; total: number; errors?: string[] }>('/products/import-csv', { items }, { timeout: 120_000 }),
  };
}

export function createServicesApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams & { category?: string }) => api.get<PaginatedResponse<Service>>('/services', { params }),
    getById: (id: string) => api.get<Service>(`/services/${id}`),
    create: (data: CreateServiceRequest) => api.post<Service>('/services', data),
    update: (id: string, data: UpdateServiceRequest) => api.patch<Service>(`/services/${id}`, data),
    remove: (id: string) => api.delete(`/services/${id}`),
  };
}

export function createChecksApi(api: HttpClient) {
  return {
    getAll: (params?: ChecksParams) => api.get<PaginatedResponse<Check>>('/checks', { params }),
    getDashboard: () => api.get<DashboardStats>('/checks/dashboard'),
    getDashboardChart: (period: string, offset?: number) => api.get<{ points: Array<{ date: string; revenue: number; profit: number; checkCount: number }>; totalRevenue: number; totalProfit: number; totalChecks: number }>('/checks/dashboard/chart', { params: { period, offset: offset ?? 0 } }),
    getRanking: () => api.get<EmployeeRanking>('/checks/ranking'),
    /**
     * Returns the most recent (non-deferred) check for the given client and/or
     * car within the current tenant. Used by the cash screen to show
     * "Последний визит: …".
     */
    getLastVisit: (params: { clientId?: string; carId?: string }) =>
      api.get<{
        id: string;
        date: string;
        number: number;
        totalRevenue: number;
        masterName: string | null;
        carPlate: string | null;
        carMakeModel: string | null;
      } | null>('/checks/last-visit', { params }),
    getById: (id: string) => api.get<Check>(`/checks/${id}`),
    create: (data: CreateCheckRequest) => api.post<Check>('/checks', data),
    update: (id: string, data: UpdateCheckRequest) => api.patch<Check>(`/checks/${id}`, data),
    remove: (id: string) => api.delete(`/checks/${id}`),
  };
}

export function createSuppliersApi(api: HttpClient) {
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
    /**
     * Return defective stock to the supplier. Server decrements defect
     * warehouse stock, lowers supplier debt by qty*purchasePrice, and
     * logs the audit row in stock_movements.
     */
    returnDefect: (
      id: string,
      body: { productId: string; qty: number; purchasePrice?: number; note?: string },
    ) => api.post<{ id: string }>(`/suppliers/${id}/return-defect`, body),
    /**
     * "Покупка б/у товара" — buy a second-hand item from a client through
     * the pinned system supplier. Only callable against the supplier with
     * `kind === 'used_purchase'`. The product (looked up by name +
     * category in the Б/У warehouse) is auto-created or its stock is
     * incremented; a delivery row goes onto the supplier ledger; a
     * stock_movement with `isUsedPurchase=true` is written for the
     * journal.
     */
    usedPurchase: (
      id: string,
      body: {
        productName: string;
        qty: number;
        purchasePrice: number;
        /** Optional — owner can defer setting the markup. */
        sellPrice?: number | null;
        category?: string;
        note?: string;
      },
    ) =>
      api.post<{
        id: string;
        productId: string;
        deliveryId: string;
        warehouseId: string;
        stockAfter: number;
        debtIncrease: number;
      }>(`/suppliers/${id}/used-purchase`, body),
  };
}

export function createSalaryApi(api: HttpClient) {
  return {
    getAll: (params?: DateRangeParams) => api.get<MasterSalary[]>('/salary', { params }),
    getMy: () => api.get<SalarySummary>('/salary/my'),
    getPayments: (params?: { userId?: string; monthYear?: string }) =>
      api.get<SalaryPayment[]>('/salary/payments', { params }),
    createPayment: (data: {
      userId: string;
      amount: number;
      monthYear: string;
      type: 'salary' | 'advance' | 'premium';
      comment?: string;
    }) => api.post<SalaryPayment>('/salary/payments', data),
    /**
     * Employee confirms receipt of a salary payment. Returns the
     * confirmation timestamp (which is sticky — re-confirming returns the
     * FIRST confirmation moment).
     */
    confirmPayment: (id: string) =>
      api.post<{ paymentId: string; userId: string; confirmedAt: string }>(`/salary/payments/${id}/confirm`),
    // Premiums (048_salary_premiums).
    premiums: {
      list: (params?: { userId?: string; monthYear?: string }) =>
        api.get<SalaryPremium[]>('/salary/premiums', { params }),
      create: (data: {
        userId: string;
        type: 'cash' | 'rate_bonus';
        amount?: number;
        bonusPercent?: number;
        reason: string;
        periodMonthYear?: string;
      }) => api.post<SalaryPremium>('/salary/premiums', data),
      remove: (id: string) => api.delete(`/salary/premiums/${id}`),
    },
    // Penalties (штрафы, 056_salary_penalties). Director / admin / superadmin
    // only — they subtract from the employee's remaining owed salary.
    listPenalties: (params?: { userId?: string }) =>
      api.get<SalaryPenalty[]>('/salary/penalties', { params }),
    addPenalty: (data: { userId: string; amount: number; description?: string; date?: string }) =>
      api.post<SalaryPenalty>('/salary/penalties', data),
    removePenalty: (id: string) => api.delete(`/salary/penalties/${id}`),
  };
}

export function createReportsApi(api: HttpClient) {
  return {
    getFinancial: (params: DateRangeParams) => api.get<FinancialReport>('/reports/financial', { params }),
    getCashFlow: (params: CashFlowParams) => api.get<{ days: Array<{ date: string; cash: number; card: number; warranty: number; total: number }>; totals: { cash: number; card: number; warranty: number; total: number } }>('/reports/cashflow', { params }),
    /**
     * Defect + writeoff aggregates for the period. Owners use this to see
     * how much value rolled into the defect warehouse, how much was
     * written off (with / without expense booking), and how much was
     * returned to suppliers (with the corresponding debt reduction).
     */
    defectWriteoff: (params: { from?: string; to?: string }) =>
      api.get<{
        dateFrom: string;
        dateTo: string;
        defectQty: number;
        defectValue: number;
        writeoffQty: number;
        writeoffValue: number;
        writeoffExpensedQty: number;
        writeoffExpensedValue: number;
        returnedToSupplierQty: number;
        returnedToSupplierValue: number;
      }>('/reports/defect-writeoff', { params }),
    callFunnel: (params: { dateFrom?: string; dateTo?: string }) =>
      api.get<CallFunnel>('/reports/call-funnel', { params }),
    /** Owner dashboard v2 — net profit, cash position, margin, deferred sum, etc. */
    dashboardV2: (params?: { period?: 'today' | 'week' | 'month' | 'year' }) =>
      api.get<DashboardV2>('/reports/dashboard-v2', { params }),
    clientsNewVsReturning: (params: { from: string; to: string }) =>
      api.get<ClientsNewVsReturning>('/reports/clients-new-vs-returning', { params }),
    alerts: () => api.get<OwnerAlert[]>('/reports/alerts'),
    bestDayOfWeek: (params: { from: string; to: string }) =>
      api.get<BestDayOfWeek>('/reports/best-day-of-week', { params }),
    recentReviews: (limit?: number) =>
      api.get<RecentReview[]>('/reports/recent-reviews', { params: { limit } }),
    retention: (params: { period: 'week' | 'month' | 'year' }) =>
      api.get<RetentionStats>('/reports/retention', { params }),
  };
}

export function createWarehousesApi(api: HttpClient) {
  return {
    list: () => api.get<Warehouse[]>('/warehouses'),
    update: (id: string, body: { name?: string; sortOrder?: number }) =>
      api.patch<Warehouse>(`/warehouses/${id}`, body),
  };
}

export function createWarrantyApi(api: HttpClient) {
  return {
    /**
     * Active (non-expired, non-used) warranties for the given client and/or car.
     * Either filter (or both) may be supplied; without filters the API
     * returns an empty array rather than the full tenant list.
     * Backend augments each row with `name` + `daysLeft`.
     */
    activeForClient: (params: { clientId?: string; carId?: string }) =>
      api.get<Array<WarrantyClaim & { name: string; daysLeft: number }>>('/warranty-claims/active', { params }),
    /**
     * Same shape but typed as `ActiveWarranty[]` for the cash screen
     * convenience — preserves backwards-compat with the older endpoint
     * naming so consumers can pick whichever they prefer.
     */
    active: (params: { clientId?: string; carId?: string }) =>
      api.get<ActiveWarranty[]>('/warranty-claims/active', { params }),
    /**
     * Active warranties for ONE car, badge-ready (itemType / itemName /
     * warrantyDays / expiresAt), soonest-to-expire first. Used by the
     * CheckCreate screen to show "Диагностика ещё N дней" chips when a car is
     * picked. Empty array if the car has none.
     */
    activeForCar: (carId: string) =>
      api.get<WarrantyActive[]>(`/warranty-claims/active-for-car/${carId}`),
    /** Mark the warranty as used against a specific (newly-created) check. */
    redeem: (id: string, checkId: string) =>
      api.post<WarrantyClaim>(`/warranty-claims/${id}/redeem`, { checkId }),
  };
}

export function createStockMovementsApi(api: HttpClient) {
  return {
    list: (params?: { warehouseId?: string; productId?: string; type?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<StockMovement[]>('/stock-movements', { params }),
    create: (body: {
      type: 'inventory' | 'income' | 'expense' | 'writeoff' | 'defect_transfer' | 'used_transfer' | 'defect_return_to_supplier';
      productId: string;
      quantity: number;
      purchasePrice?: number;
      reason?: string;
      warehouseId?: string;
      sourceWarehouseId?: string;
      targetWarehouseId?: string;
      supplierId?: string;
      recordAsExpense?: boolean;
    }) => api.post<{ id: string }>('/stock-movements', body),
    /**
     * Convenience wrapper for the most common "transfer to defect" flow:
     * provide source warehouse + product + qty + reason. Backend resolves
     * the defect warehouse from kind='defect' for the tenant.
     */
    transferToDefect: (body: {
      productId: string;
      fromWarehouseId: string;
      quantity: number;
      reason: string;
    }) => api.post<{ id: string }>('/stock-movements/transfer-to-defect', body),
  };
}

export function createShiftsApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams) => api.get<Shift[]>('/shifts', { params }),
    getMy: () => api.get<Shift[]>('/shifts/my'),
    open: (data?: Record<string, unknown>) => api.post<Shift>('/shifts/open', data),
    close: (id: string) => api.post<Shift>(`/shifts/${id}/close`),
  };
}

export function createScheduleApi(api: HttpClient) {
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

export function createExpensesApi(api: HttpClient) {
  return {
    getCategories: () =>
      api.get<Array<{ id: string; name: string; approvalRequired?: boolean }>>('/expenses/categories'),
    createCategory: (data: { name: string; approvalRequired?: boolean }) =>
      api.post<ExpenseCategory>('/expenses/categories', data),
    /** Toggle `approvalRequired` (or rename) a category. Director / admin / superadmin only (#11). */
    updateCategory: (id: string, data: { name?: string; approvalRequired?: boolean }) =>
      api.patch<ExpenseCategory>(`/expenses/categories/${id}`, data),
    removeCategory: (id: string) => api.delete(`/expenses/categories/${id}`),
    // The server now exposes `createdBy`, `creatorName`, `source` and
    // `approvalStatus` for every row (migration 047). They're optional
    // on the TS side so legacy callers / older backends keep compiling.
    // `createdBy` filter narrows the listing to a single employee (used
    // by the owner's "По сотруднику" chip); `approvalStatus` filter is
    // used by the "Ожидает одобрения" review queue.
    getAll: (params?: DateRangeParams & { createdBy?: string; approvalStatus?: 'pending' | 'approved' | 'rejected' }) =>
      api.get<
        Array<{
          id: string;
          categoryId?: string;
          categoryName?: string;
          amount: number;
          description?: string;
          date: string;
          userId?: string;
          userName?: string;
          createdBy?: string;
          creatorName?: string;
          source?: 'owner' | 'employee';
          approvalStatus?: 'approved' | 'pending' | 'rejected';
          createdAt: string;
        }>
      >('/expenses', { params }),
    create: (data: { categoryId?: string; amount: number; description?: string; date?: string }) => api.post('/expenses', data),
    /** Owner approves a pending expense — flips approval_status to 'approved'. Director / admin / superadmin only. */
    approve: (id: string) => api.patch(`/expenses/${id}/approve`),
    /** Owner rejects a pending expense — flips approval_status to 'rejected'. Director / admin / superadmin only. */
    reject: (id: string) => api.patch(`/expenses/${id}/reject`),
    remove: (id: string) => api.delete(`/expenses/${id}`),
  };
}

export function createWarehouseCategoriesApi(api: HttpClient) {
  return {
    // After migration 032 every category belongs to a specific
    // warehouse. The optional `warehouseId` filter scopes the read to
    // that warehouse; omitting it falls back to the tenant's main
    // warehouse on the server (legacy behaviour).
    getAll: (warehouseId?: string) =>
      api.get<Array<{ id: string; path: string; sort_order: number }>>(
        '/warehouse/categories',
        warehouseId ? { params: { warehouseId } } : undefined,
      ),
    create: (path: string, warehouseId?: string) =>
      api.post<{ id: string; path: string }>(
        '/warehouse/categories',
        warehouseId ? { path, warehouseId } : { path },
      ),
    remove: (id: string, opts?: { moveTo?: string; deleteContents?: boolean }) => {
      const params = new URLSearchParams();
      if (opts?.moveTo !== undefined) params.set('moveTo', opts.moveTo);
      if (opts?.deleteContents) params.set('deleteContents', 'true');
      const qs = params.toString();
      return api.delete(`/warehouse/categories/${id}${qs ? `?${qs}` : ''}`);
    },
    updateOrder: (orderedIds: string[]) => api.patch('/warehouse/categories/order', { orderedIds }),
    rename: (id: string, newPath: string) => api.patch(`/warehouse/categories/${id}/rename`, { newPath }),
  };
}

export function createMarketingApi(api: HttpClient) {
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
    testIntegration: (id?: string) => api.post('/marketing/integrations/test', { id }),
    sendSms: (data: { phone: string; text: string }) => api.post('/marketing/sms/send', data),
    getReminderSettings: () => api.get<ReminderSettings>('/marketing/reminders'),
    updateReminderSettings: (data: Partial<ReminderSettings>) =>
      api.post<ReminderSettings>('/marketing/reminders', data),
    sendReminders: () => api.post<{ sent: number; errors: number }>('/marketing/reminders/send'),
  };
}

export function createPublicReviewApi(api: HttpClient) {
  return {
    getByToken: (token: string) => api.get<PublicReviewData>(`/marketing/review/${token}`),
    submit: (token: string, data: { rating: number; comment?: string; redirectedTo?: string }) => api.post<{ success: boolean }>(`/marketing/review/${token}`, data),
  };
}

export function createCallsApi(api: HttpClient) {
  return {
    getCalls: (params: { date?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; summary: { total: number; incoming: number; outgoing: number; missed: number; notCalledBack: number } }>('/calls', { params }),
    getClientCalls: (clientId: string, params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; total: number }>(`/calls/client/${clientId}`, { params }),
    /**
     * #15 — calls for one client (alias of getClientCalls). Each call carries
     * `recordingUrl`; play it via `getRecordingUrl(url)` which validates the
     * MoiZvonki origin server-side.
     */
    getByClient: (clientId: string, params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; total: number }>(`/calls/client/${clientId}`, { params }),
    getClientSms: (clientId: string) =>
      api.get<any[]>(`/calls/client/${clientId}/sms`),
    getClientSmsHistory: (clientId: string) =>
      api.get<any[]>(`/calls/client/${clientId}/sms`),
    getRecordingUrl: (url: string) =>
      api.get<{ url: string }>('/calls/recording', { params: { url } }),
  };
}

export function createEquipmentApi(api: HttpClient) {
  return {
    // Storage room
    getCategories: () => api.get<any[]>('/equipment/categories'),
    createCategory: (data: any) => api.post('/equipment/categories', data),
    removeCategory: (id: string) => api.delete(`/equipment/categories/${id}`),
    getStorageItems: (params?: any) => api.get<any[]>('/equipment/storage', { params }),
    createStorageItem: (data: any) => api.post('/equipment/storage', data),
    updateStorageItem: (id: string, data: any) => api.patch(`/equipment/storage/${id}`, data),
    /**
     * Delete a storage item. Pass `reverseExpense: true` to also delete the
     * linked «Имущество» auto-expense ("вернуть деньги в оборот", #14); omit /
     * false keeps the expense ("расход остаётся"). Sent as a query param so it
     * survives clients that strip DELETE bodies.
     */
    removeStorageItem: (id: string, opts?: { reverseExpense?: boolean }) =>
      api.delete(`/equipment/storage/${id}`, { params: { reverseExpense: opts?.reverseExpense ? 'true' : 'false' } }),
    // Employees
    getSummary: () => api.get<any[]>('/equipment/summary'),
    getByUser: (userId: string, includeInactive?: boolean) =>
      api.get<any[]>(`/equipment/user/${userId}`, { params: includeInactive ? { includeInactive: 'true' } : {} }),
    getMyEquipment: () => api.get<any[]>('/equipment/my'),
    // Actions
    issue: (data: any) => api.post('/equipment/issue', data),
    replace: (id: string, data: any) => api.post(`/equipment/${id}/replace`, data),
    trash: (id: string, reason?: string) => api.post(`/equipment/${id}/trash`, { reason }),
    restore: (id: string) => api.post(`/equipment/${id}/restore`),
    returnToStorage: (id: string) => api.post(`/equipment/${id}/return-storage`),
    remove: (id: string) => api.delete(`/equipment/${id}`),
    // Trash
    getTrash: () => api.get<any[]>('/equipment/trash'),
  };
}

export function createCheckPhotosApi(api: HttpClient) {
  return {
    getByCheck: (checkId: string) =>
      api.get<CheckPhoto[]>(`/check-photos/${checkId}`),
    upload: (checkId: string, formData: unknown) =>
      api.post<CheckPhoto>(`/check-photos/${checkId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      } as unknown),
    remove: (id: string) => api.delete(`/check-photos/${id}`),
  };
}

export function createCheckTemplatesApi(api: HttpClient) {
  return {
    list: () => api.get<CheckTemplate[]>('/check-templates'),
    create: (data: { name: string; services: CheckTemplate['services']; products: CheckTemplate['products'] }) =>
      api.post<CheckTemplate>('/check-templates', data),
    update: (id: string, data: Partial<Pick<CheckTemplate, 'name' | 'services' | 'products'>>) =>
      api.put<CheckTemplate>(`/check-templates/${id}`, data),
    remove: (id: string) => api.delete(`/check-templates/${id}`),
  };
}

export function createPushApi(api: HttpClient) {
  return {
    register: (token: string, platform: 'ios' | 'android') =>
      api.post('/push/token', { token, platform }),
    unregister: (token: string) =>
      api.delete('/push/token', { data: { token } } as unknown),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Returns API — full or partial returns of a check.
// ───────────────────────────────────────────────────────────────────────

export function createReturnsApi(api: HttpClient) {
  return {
    list: (params?: { from?: string; to?: string }) =>
      api.get<CheckReturn[]>('/returns', { params }),
    create: (
      checkId: string,
      body: {
        destination: 'warehouse' | 'defect';
        reason?: string;
        scope: 'full' | 'partial';
        refundAmount?: number;
        lines?: { productLineId?: string; serviceLineId?: string; quantity?: number }[];
      },
    ) => api.post<CheckReturn>(`/returns/${checkId}`, body),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Schedule settings (which attendance statuses count as a shift)
// ───────────────────────────────────────────────────────────────────────

export function createScheduleSettingsApi(api: HttpClient) {
  return {
    get: () => api.get<ScheduleSettings>('/schedule/settings'),
    update: (data: Partial<ScheduleSettings>) =>
      api.post<ScheduleSettings>('/schedule/settings', data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Employees — extended profile, photo, documents, achievements
// ───────────────────────────────────────────────────────────────────────

export function createEmployeesApi(api: HttpClient) {
  return {
    update: (id: string, body: Partial<EmployeeProfile>) =>
      api.patch<EmployeeProfile>(`/employees/${id}`, body),
    uploadPhoto: (id: string, form: unknown) =>
      api.post<{ photoUrl: string }>(`/employees/${id}/photo`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      } as unknown),
    /**
     * Employee composite profile. The backend treats the 365-day `yearHeatmap`
     * and `careerTimeline` as OPT-IN via `?include=` — when not requested they
     * come back as empty arrays, so the server skips that GROUP BY / scan on
     * the most-opened path.
     *
     * Default here is `['heatmap']` (NOT light) on purpose: the live mobile
     * detail screen derives salary period totals from `yearHeatmap`, so the
     * factory keeps requesting it to stay backward-compatible with shipped
     * clients. `careerTimeline` is never requested by default (no client draws
     * it), which is where the saved work comes from.
     *
     * Pass an explicit array to override: `[]` for the truly light profile,
     * `['heatmap','timeline']` to get both back.
     */
    fullProfile: (id: string, include: Array<'heatmap' | 'timeline'> = ['heatmap']) => {
      const qs = include.length > 0 ? `?include=${include.join(',')}` : '';
      return api.get<EmployeeFullProfile>(`/employees/${id}/full-profile${qs}`);
    },
    documents: (id: string) =>
      api.get<EmployeeDocument[]>(`/employees/${id}/documents`),
    uploadDocument: (id: string, form: unknown) =>
      api.post<EmployeeDocument>(`/employees/${id}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      } as unknown),
    deleteDocument: (id: string, docId: string) =>
      api.delete(`/employees/${id}/documents/${docId}`),
    achievements: (id: string) =>
      api.get<EmployeeAchievement[]>(`/employees/${id}/achievements`),
    addAchievement: (
      id: string,
      body: { name: string; description?: string; icon?: string; color?: string },
    ) => api.post<EmployeeAchievement>(`/employees/${id}/achievements`, body),
    removeAchievement: (id: string, achId: string) =>
      api.delete(`/employees/${id}/achievements/${achId}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Warehouse analytics (045_stock_value_snapshots + computed endpoints)
// ───────────────────────────────────────────────────────────────────────

export function createWarehouseAnalyticsApi(api: HttpClient) {
  return {
    summary: (params: { warehouseId?: string; period?: 'week' | 'month' | 'quarter' | 'year' }) =>
      api.get<WarehouseSummary>('/warehouse-analytics/summary', { params }),
    velocity: (params: { warehouseId?: string; period?: 'week' | 'month' | 'quarter' | 'year' }) =>
      api.get<VelocityRow[]>('/warehouse-analytics/velocity', { params }),
    reorderForecast: (params?: { warehouseId?: string }) =>
      api.get<ReorderItem[]>('/warehouse-analytics/reorder-forecast', { params }),
    categoryMargin: (params: { period?: 'week' | 'month' | 'quarter' | 'year' }) =>
      api.get<CategoryMargin[]>('/warehouse-analytics/category-margin', { params }),
    topMoving: (params: { period?: 'week' | 'month' | 'quarter' | 'year'; limit?: number }) =>
      api.get<TopProduct[]>('/warehouse-analytics/top-moving', { params }),
    topMargin: (params: { period?: 'week' | 'month' | 'quarter' | 'year'; limit?: number }) =>
      api.get<TopProduct[]>('/warehouse-analytics/top-margin', { params }),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Client sources (per-tenant pickable list)
// ───────────────────────────────────────────────────────────────────────

export function createClientSourcesApi(api: HttpClient) {
  return {
    get: () => api.get<ClientSources>('/client-sources'),
    update: (sources: string[]) => api.post<ClientSources>('/client-sources', { sources }),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Journal (unified warehouse documents feed)
// ───────────────────────────────────────────────────────────────────────

export function createJournalApi(api: HttpClient) {
  return {
    warehouseDocs: (params: {
      from?: string;
      to?: string;
      type?:
        | 'purchase'
        | 'return_to_supplier'
        | 'defect_transfer'
        | 'writeoff'
        | 'supplier_payment'
        | 'used_purchase';
    }) => api.get<JournalDoc[]>('/journal/warehouse-docs', { params }),
  };
}

export function createImportsApi(api: HttpClient) {
  // Bulk imports can run for a couple of minutes server-side; default axios
  // timeout of 15s would kill the request well before preview/confirm finishes.
  // Match the nginx `proxy_read_timeout` (600s) with a small headroom.
  const longTimeout = { timeout: 600_000 };
  return {
    /** Returns a CSV template for clients+cars import (text/csv). */
    getClientsCarsTemplate: () =>
      api.get<string>('/imports/clients-cars/template', { responseType: 'text' as any }),
    /** Dry-run: validates and groups rows, returns preview without writing. */
    previewClientsCars: (data: ImportPreviewRequest) =>
      api.post<ImportPreviewResponse>('/imports/clients-cars/preview', data, longTimeout),
    /** Commits the import in a transaction. Re-runs validation server-side. */
    confirmClientsCars: (data: ImportConfirmRequest) =>
      api.post<ImportConfirmResponse>('/imports/clients-cars/confirm', data, longTimeout),
  };
}
