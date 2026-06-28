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
  User,
  UserPermissions,
  PermissionTemplate,
  SectionVisibility,
  ItemVisibility,
  Tenant,
  Plan,
  Client,
  Car,
  Product,
  ProductPriceHistoryEntry,
  Service,
  Check,
  ChecksBoard,
  WorkBoardColumn,
  PosSettings,
  Supplier,
  Delivery,
  SupplierPayment,
  MasterSalary,
  SalarySummary,
  SalaryPayment,
  MotivationPromo,
  MotivationAccrual,
  FinancialReport,
  DashboardStats,
  EmployeeRanking,
  Shift,
  ScheduleEntry,
  WorkMode,
  StockMovement,
  PaginatedResponse,
  SubscriptionInfo,
  PlatformStats,
  MrrTrendPoint,
  TodayEmployeeStatus,
  MarketingDashboard,
  ReviewResponse,
  ReviewAlert,
  MessagingIntegration,
  CarReadyNotificationSettings,
  ReviewPlatformLink,
  ReviewSettings,
  PublicReviewData,
  Warehouse,
  WarrantyClaim,
  CheckPhoto,
  CheckTemplate,
  CallFunnel,
  ReminderSettings,
  WinbackClient,
  WinbackSendResult,
  CheckReturn,
  ScheduleSettings,
  EmployeeProfile,
  EmployeeDocument,
  EmployeeAchievement,
  EmployeeFullProfile,
  DashboardV2,
  ClientsNewVsReturning,
  OwnerAlert,
  BestDayOfWeek,
  RecentReview,
  RetentionStats,
  WarehouseSummary,
  VelocityRow,
  ReorderItem,
  CategoryMargin,
  TopProduct,
  ActiveWarranty,
  WarrantyActive,
  ClientSources,
  PerCarChecks,
  SalaryPremium,
  SalaryPenalty,
  ExpenseCategory,
  JournalDoc,
  KnowledgeCategory,
  KnowledgeArticle,
  KnowledgeSearchResults,
  KnowledgeAcksResponse,
  RegulationUserSummary,
  ArticleFeedbackResult,
  KnowledgeCourse,
  KnowledgeLesson,
  LessonProgress,
  CourseProgress,
  Troubleshooting,
  KnowledgeForCar,
  NotificationPreferences,
  NotificationCategory,
  Broadcast,
  BroadcastHistoryItem,
  TenantMetrics,
  ImpersonateResponse,
  AuditLogEntry,
  Booking,
  BookingMutationResult,
  BookingSettings,
  CashShift,
  CashShiftReport,
  ClientDebtSummary,
  Debtor,
  InstallmentPlan,
  InstallmentClientLedger,
  InstallmentWidget,
  InstallmentReminderSettings,
  InstallmentReminderSendResult,
  LoyaltySettings,
  ClientBonusSummary,
  BonusType,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderSuggestionGroup,
  PaymentIntegrationSettings,
  Payment,
  AcquiringMethod,
  PaymentProviderName,
  FiscalSettings,
  FiscalReceipt,
  FiscalProviderName,
  FiscalSno,
  FiscalVat,
  TelephonySettings,
  TelephonyProviderName,
  WalletSettings,
} from '../types';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  DeleteAccountRequest,
  DeleteAccountResponse,
  PaginationParams,
  ChecksParams,
  CarsQuery,
  DateRangeParams,
  CashFlowParams,
  CreateUserRequest,
  UpdateUserRequest,
  CreateClientRequest,
  UpdateClientRequest,
  CreateCarRequest,
  UpdateCarRequest,
  CreateProductRequest,
  UpdateProductRequest,
  StockUpdateRequest,
  CreateServiceRequest,
  UpdateServiceRequest,
  CreateCheckRequest,
  UpdateCheckRequest,
  CreateSupplierRequest,
  UpdateSupplierRequest,
  CreateDeliveryRequest,
  CreatePaymentRequest,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  CreateWorkModeRequest,
  UpdateWorkModeRequest,
  CreateTenantRequest,
  UpdateTenantRequest,
  ExtendSubscriptionRequest,
  AssignPlanRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportConfirmRequest,
  ImportConfirmResponse,
  KnowledgeCategoryInput,
  KnowledgeArticleInput,
  ListArticlesParams,
  KnowledgeCourseInput,
  KnowledgeLessonInput,
  CompleteLessonInput,
  TroubleshootingInput,
  ListTroubleshootingParams,
  ForCarParams,
  CreateBroadcastRequest,
  ListBookingsParams,
  CreateBookingRequest,
  UpdateBookingRequest,
  ConvertBookingRequest,
  UpdateBookingSettingsRequest,
} from './types';

export function createAuthApi(api: HttpClient) {
  return {
    login: (data: LoginRequest) => api.post<LoginResponse>('/auth/login', data),
    register: (data: RegisterRequest) => api.post<LoginResponse>('/auth/register', data),
    me: () => api.get<User>('/auth/me'),
    logout: () => api.post('/auth/logout'),
    updateAvatar: (avatar: string) => api.patch<{ avatar: string }>('/auth/avatar', { avatar }),
    // In-app account deletion (Apple Guideline 5.1.1(v) + Google Play). Director
    // → closes the whole tenant account (access revoked now, purge after grace);
    // a non-owner employee → anonymizes + retires their own record. Requires the
    // current password + an explicit confirm flag. After a 200, the client must
    // drop its token and return to the login screen.
    deleteAccount: (data: DeleteAccountRequest) => api.post<DeleteAccountResponse>('/account/delete', data),
  };
}

export function createUsersApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams) => api.get<User[]>('/users', { params }),
    getMasters: (params?: PaginationParams) => api.get<User[]>('/users/masters', { params }),
    getById: (id: string) => api.get<User>(`/users/${id}`),
    create: (data: CreateUserRequest) => api.post<User>('/users', data),
    update: (id: string, data: UpdateUserRequest) => api.patch<User>(`/users/${id}`, data),
    // remove() no longer hard-deletes — it SOFT-DISMISSES (moves the employee to
    // «Уволенные»). The row is kept so historical checks/shifts resolve the name.
    remove: (id: string) => api.delete(`/users/${id}`),
    // «Уволенные» recycle bin: list dismissed-not-purged, restore, or purge.
    listDismissed: () => api.get<User[]>('/users/dismissed'),
    restore: (id: string) => api.post<User>(`/users/${id}/restore`),
    purge: (id: string) => api.post(`/users/${id}/purge`),
    // 071 — per-employee section visibility overrides. The list returns ONLY the
    // explicit overrides; an absent section falls back to its default (visible).
    getSectionVisibility: (userId: string) => api.get<SectionVisibility[]>(`/users/${userId}/section-visibility`),
    updateSectionVisibility: (userId: string, sections: SectionVisibility[]) =>
      api.patch<SectionVisibility[]>(`/users/${userId}/section-visibility`, { sections }),
    // 073 — granular per-employee ITEM visibility overrides (additive to the
    // group-level section-visibility above). The list returns the materialized
    // map for every known item key (defaults merged with explicit overrides).
    getItemVisibility: (userId: string) => api.get<ItemVisibility[]>(`/users/${userId}/item-visibility`),
    updateItemVisibility: (userId: string, items: ItemVisibility[]) =>
      api.patch<ItemVisibility[]>(`/users/${userId}/item-visibility`, { items }),
    // Server-enforced action permissions. getPermissions returns the stored map
    // (may be partial / empty for an existing master); updatePermissions replaces
    // it. The server applies self-lockout protection (you can't strip your own
    // user_management) and tenant-scopes the target. Additive to update() above,
    // which also accepts a `permissions` field.
    getPermissions: (userId: string) => api.get<UserPermissions>(`/users/${userId}/permissions`),
    updatePermissions: (userId: string, permissions: UserPermissions) =>
      api.patch<UserPermissions>(`/users/${userId}/permissions`, { permissions }),
    getProductCommissions: (id: string) => api.get(`/users/${id}/product-commissions`),
    setProductCommissions: (
      id: string,
      data: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> },
    ) => api.post(`/users/${id}/product-commissions`, data),
    updateOrder: (orderedIds: string[]) => api.post('/users/order', { orderedIds }),
  };
}

export function createTenantsApi(api: HttpClient) {
  return {
    getAll: () => api.get<Tenant[]>('/tenants'),
    getStats: () => api.get<PlatformStats>('/tenants/stats'),
    getById: (id: string) => api.get<Tenant>(`/tenants/${id}`),
    getMetrics: (id: string) => api.get<TenantMetrics>(`/tenants/${id}/metrics`),
    create: (data: CreateTenantRequest) => api.post<Tenant>('/tenants', data),
    update: (id: string, data: UpdateTenantRequest) => api.patch<Tenant>(`/tenants/${id}`, data),
    remove: (id: string) => api.delete(`/tenants/${id}`),
    // ── Subscription management (superadmin, from the tenant card) ──
    extend: (id: string, days: number) =>
      api.post<Tenant>(`/tenants/${id}/extend`, { days } satisfies ExtendSubscriptionRequest),
    assignPlan: (id: string, planId: string) =>
      api.post<Tenant>(`/tenants/${id}/assign-plan`, { planId } satisfies AssignPlanRequest),
    impersonate: (id: string) => api.post<ImpersonateResponse>(`/tenants/${id}/impersonate`),
  };
}

/** Superadmin platform-operator endpoints not tied to a single tenant. */
export function createAdminApi(api: HttpClient) {
  return {
    listAuditLog: () => api.get<AuditLogEntry[]>('/admin/audit-log'),
    /**
     * Monthly MRR trend for the admin dashboard (096). `months` defaults to 12
     * server-side and is clamped to 1..36. Oldest month first.
     */
    getMrrTrends: (months?: number) =>
      api.get<MrrTrendPoint[]>('/admin/mrr-trends', { params: months !== undefined ? { months } : undefined }),
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
    updateSource: (id: string, source: string | null) => api.patch<Client>(`/clients/${id}/source`, { source }),
    /** Update just the owner notes. */
    updateNotes: (id: string, notes: string | null) => api.patch<Client>(`/clients/${id}/notes`, { notes }),
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
    checks: (carId: string, params?: { limit?: number }) => api.get<Check[]>(`/cars/${carId}/checks`, { params }),
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
    getAll: (params?: PaginationParams & { warehouseId?: string }) =>
      api.get<PaginatedResponse<Product>>('/products', { params }),
    getLowStock: () => api.get<Product[]>('/products/low-stock'),
    getMovements: (params?: PaginationParams) => api.get<StockMovement[]>('/products/movements', { params }),
    getWarehouseStats: () =>
      api.get<{
        totalCostValue: number;
        totalSellValue: number;
        totalItems: number;
        monthProductCost: number;
        lastMonthProductCost: number;
      }>('/products/warehouse-stats'),
    getById: (id: string) => api.get<Product>(`/products/${id}`),
    create: (data: CreateProductRequest) => api.post<Product>('/products', data),
    update: (id: string, data: UpdateProductRequest) => api.patch<Product>(`/products/${id}`, data),
    /** Set just the sell price on an existing product. */
    setSellPrice: (id: string, sellPrice: number) => api.patch<Product>(`/products/${id}/sell-price`, { sellPrice }),
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
    /** Typed price-change ledger for ONE product (newest first, ≤50 rows). */
    priceHistory: (id: string) => api.get<ProductPriceHistoryEntry[]>(`/products/${id}/price-history`),
    exportCsv: () => api.get('/products/export-csv', { responseType: 'blob' }),
    importCsv: (
      items: Array<{
        name: string;
        category?: string;
        costPrice?: number;
        sellPrice?: number;
        stock?: number;
        minStock?: number;
        unit?: string;
      }>,
    ) =>
      api.post<{ created: number; updated: number; skipped?: number; total: number; errors?: string[] }>(
        '/products/import-csv',
        { items },
        { timeout: 120_000 },
      ),
  };
}

export function createServicesApi(api: HttpClient) {
  return {
    getAll: (params?: PaginationParams & { category?: string }) =>
      api.get<PaginatedResponse<Service>>('/services', { params }),
    getById: (id: string) => api.get<Service>(`/services/${id}`),
    create: (data: CreateServiceRequest) => api.post<Service>('/services', data),
    update: (id: string, data: UpdateServiceRequest) => api.patch<Service>(`/services/${id}`, data),
    remove: (id: string) => api.delete(`/services/${id}`),
  };
}

export function createChecksApi(api: HttpClient) {
  return {
    // `isDeferred` is additive: true → only deferred drafts, false → only
    // closed checks, absent → unfiltered (legacy behaviour).
    getAll: (params?: ChecksParams & { isDeferred?: boolean }) =>
      api.get<PaginatedResponse<Check>>('/checks', { params }),
    getDashboard: () => api.get<DashboardStats>('/checks/dashboard'),
    getDashboardChart: (period: string, offset?: number) =>
      api.get<{
        points: Array<{ date: string; revenue: number; profit: number; checkCount: number }>;
        totalRevenue: number;
        totalProfit: number;
        totalChecks: number;
      }>('/checks/dashboard/chart', { params: { period, offset: offset ?? 0 } }),
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
    /**
     * 092 — POS «Кассовая смена + роли» settings. GET is readable by any role
     * (a master reads it to learn the mode + whether they're a cashier, for the
     * tab-bar swap + order-create flow). PATCH is owner-gated (director/admin/
     * superadmin); body carries only `shiftModeEnabled`.
     */
    getPosSettings: () => api.get<PosSettings>('/checks/pos-settings'),
    updatePosSettings: (data: { shiftModeEnabled: boolean }) =>
      api.patch<{ shiftModeEnabled: boolean }>('/checks/pos-settings', data),
    getById: (id: string) => api.get<Check>(`/checks/${id}`),
    create: (data: CreateCheckRequest) => api.post<Check>('/checks', data),
    update: (id: string, data: UpdateCheckRequest) => api.patch<Check>(`/checks/${id}`, data),
    remove: (id: string) => api.delete(`/checks/${id}`),
    /**
     * Kanban board (091): owner-configurable columns + checks grouped by column
     * key, tenant-scoped, newest-first per column. Shape is now
     * { columns, groups } (see ChecksBoard) — a breaking change vs the old fixed
     * {accepted,in_progress,ready,delivered} object.
     */
    board: () => api.get<ChecksBoard>('/checks/board'),
    /**
     * Move a check along the kanban board (082 + 091). `workStatus` is a column
     * KEY — must be the key of one of the tenant's active board columns (server
     * validates; 400 otherwise). Orthogonal to payment — sets only the
     * work_status flag; returns the full updated check.
     */
    setWorkStatus: (id: string, workStatus: string) =>
      api.patch<Check>(`/checks/${id}/work-status`, { workStatus }),
    /**
     * Owner-configurable board columns (091). Read is open to board-viewing
     * roles; create/update/remove are owner-class only (server-enforced).
     * Deleting a column takes any checks parked in it off the board.
     */
    boardColumns: {
      list: () => api.get<WorkBoardColumn[]>('/checks/board-columns'),
      create: (data: { label: string; color?: string; notifyClient?: boolean }) =>
        api.post<WorkBoardColumn>('/checks/board-columns', data),
      update: (
        id: string,
        data: { label?: string; color?: string; sortOrder?: number; isActive?: boolean; notifyClient?: boolean },
      ) => api.patch<WorkBoardColumn>(`/checks/board-columns/${id}`, data),
      remove: (id: string) => api.delete(`/checks/board-columns/${id}`),
    },
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
    returnDefect: (id: string, body: { productId: string; qty: number; purchasePrice?: number; note?: string }) =>
      api.post<{ id: string }>(`/suppliers/${id}/return-defect`, body),
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
    listPenalties: (params?: { userId?: string }) => api.get<SalaryPenalty[]>('/salary/penalties', { params }),
    addPenalty: (data: { userId: string; amount: number; description?: string; date?: string }) =>
      api.post<SalaryPenalty>('/salary/penalties', data),
    removePenalty: (id: string) => api.delete(`/salary/penalties/${id}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  «Мотивация сотрудников» v1 — акционные товары (095_motivation_promo_products).
//  Backend: motivation/. The owner marks products as «акционные» with a percent;
//  when such a product is sold on a PAID check the credited master (checks.master_id)
//  earns percent × margin, accrued into a ledger and summed into the salary
//  «Мотивация» component (MasterSalary.motivationAmount).
//
//  Promo config (getPromos / setPromo / clearPromo) is owner-class
//  (director / admin / superadmin) server-side. `getAccruals` is open to any
//  tenant user but the backend force-scopes a non-privileged caller to their OWN
//  accruals (a master sees their own bonuses, not a colleague's).
// ───────────────────────────────────────────────────────────────────────

export function createMotivationApi(api: HttpClient) {
  return {
    /** All promo products for the tenant (owner-class), joined with current prices. */
    getPromos: () => api.get<MotivationPromo[]>('/motivation/promos'),
    /**
     * Set / update a product's promo percent (upsert by tenant+product). `percent`
     * is the bonus rate applied to the sale margin (0..100). Optionally pause via
     * `active:false` or bound it with `startsAt` / `endsAt`.
     */
    setPromo: (data: { productId: string; percent: number; active?: boolean; startsAt?: string; endsAt?: string }) =>
      api.post<MotivationPromo>('/motivation/promos', data),
    /** Remove a product from the promo programme. Idempotent. */
    clearPromo: (productId: string) => api.delete(`/motivation/promos/${productId}`),
    /**
     * Accrual ledger for transparency. Director / admin / superadmin get the whole
     * tenant (optionally `?userId=`); any other role is force-scoped to self.
     */
    getAccruals: (params?: { userId?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<MotivationAccrual[]>('/motivation/accruals', { params }),
  };
}

export function createReportsApi(api: HttpClient) {
  return {
    getFinancial: (params: DateRangeParams) => api.get<FinancialReport>('/reports/financial', { params }),
    getCashFlow: (params: CashFlowParams) =>
      api.get<{
        days: Array<{ date: string; cash: number; card: number; warranty: number; total: number }>;
        totals: { cash: number; card: number; warranty: number; total: number };
      }>('/reports/cashflow', { params }),
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
    recentReviews: (limit?: number) => api.get<RecentReview[]>('/reports/recent-reviews', { params: { limit } }),
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
    activeForCar: (carId: string) => api.get<WarrantyActive[]>(`/warranty-claims/active-for-car/${carId}`),
    /** Mark the warranty as used against a specific (newly-created) check. */
    redeem: (id: string, checkId: string) => api.post<WarrantyClaim>(`/warranty-claims/${id}/redeem`, { checkId }),
  };
}

export function createStockMovementsApi(api: HttpClient) {
  return {
    list: (params?: { warehouseId?: string; productId?: string; type?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<StockMovement[]>('/stock-movements', { params }),
    create: (body: {
      type:
        | 'inventory'
        | 'income'
        | 'expense'
        | 'writeoff'
        | 'defect_transfer'
        | 'used_transfer'
        | 'defect_return_to_supplier';
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
    transferToDefect: (body: { productId: string; fromWarehouseId: string; quantity: number; reason: string }) =>
      api.post<{ id: string }>('/stock-movements/transfer-to-defect', body),
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
    applyWorkMode: (data: { workModeId: string; userId?: string; dateFrom: string; dateTo: string }) =>
      api.post<{ created: number }>('/schedule/apply-work-mode', data),
    getToday: () => api.get<TodayEmployeeStatus[]>('/schedule/today'),
    // `params` is additive: omit for the historical current-month stats,
    // pass dateFrom/dateTo (YYYY-MM-DD) for an arbitrary period.
    getMyStats: (params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{
        totalScheduled: number;
        totalWorked: number;
        totalLate: number;
        totalLateMinor: number;
        totalLateMajor: number;
        totalOnTime: number;
        totalDaysOff: number;
        avgLateMinutes: number;
      }>('/schedule/my-stats', { params }),
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
    create: (data: { categoryId?: string; amount: number; description?: string; date?: string }) =>
      api.post('/expenses', data),
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
      api.post<{ id: string; path: string }>('/warehouse/categories', warehouseId ? { path, warehouseId } : { path }),
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
    getReviews: (params?: { employeeId?: string; minRating?: number; maxRating?: number; month?: string }) =>
      api.get<ReviewResponse[]>('/marketing/reviews', { params }),
    getAlerts: () => api.get<ReviewAlert[]>('/marketing/alerts'),
    markAlertRead: (id: string) => api.patch(`/marketing/alerts/${id}/read`),
    getIntegrations: () => api.get<MessagingIntegration[]>('/marketing/integrations'),
    upsertIntegration: (data: {
      id?: string;
      providerType: string;
      apiKey: string;
      senderName?: string;
      senderPhone?: string;
      webhookUrl?: string;
      // WhatsApp Cloud API phoneNumberId (087).
      phoneNumberId?: string;
      // Telegram owner/staff chat_id (087).
      chatId?: string;
      isActive?: boolean;
    }) => api.post<MessagingIntegration[]>('/marketing/integrations', data),
    removeIntegration: (id: string) => api.delete(`/marketing/integrations/${id}`),
    getPlatformLinks: () => api.get<ReviewPlatformLink[]>('/marketing/platform-links'),
    upsertPlatformLink: (data: { platform: string; url: string; isActive?: boolean }) =>
      api.post<ReviewPlatformLink[]>('/marketing/platform-links', data),
    removePlatformLink: (id: string) => api.delete(`/marketing/platform-links/${id}`),
    getSettings: () => api.get<ReviewSettings>('/marketing/settings'),
    updateSettings: (data: Partial<ReviewSettings>) => api.patch<ReviewSettings>('/marketing/settings', data),
    // «Машина готова» auto-notification settings (087).
    getCarReadySettings: () => api.get<CarReadyNotificationSettings>('/marketing/car-ready'),
    updateCarReadySettings: (data: Partial<CarReadyNotificationSettings>) =>
      api.patch<CarReadyNotificationSettings>('/marketing/car-ready', data),
    testIntegration: (id?: string) => api.post('/marketing/integrations/test', { id }),
    sendSms: (data: { phone: string; text: string }) => api.post('/marketing/sms/send', data),
    getReminderSettings: () => api.get<ReminderSettings>('/marketing/reminders'),
    updateReminderSettings: (data: Partial<ReminderSettings>) =>
      api.post<ReminderSettings>('/marketing/reminders', data),
    sendReminders: () => api.post<{ sent: number; errors: number }>('/marketing/reminders/send'),
    // Win-back («давно не приезжал»): preview the segment, then broadcast.
    winback: (days?: number) =>
      api.get<WinbackClient[]>('/marketing/winback', { params: days != null ? { days } : undefined }),
    winbackSend: (data: { days: number; message: string }) =>
      api.post<WinbackSendResult>('/marketing/winback/send', data),
  };
}

export function createPublicReviewApi(api: HttpClient) {
  return {
    getByToken: (token: string) => api.get<PublicReviewData>(`/marketing/review/${token}`),
    submit: (token: string, data: { rating: number; comment?: string; redirectedTo?: string }) =>
      api.post<{ success: boolean }>(`/marketing/review/${token}`, data),
  };
}

export function createCallsApi(api: HttpClient) {
  return {
    getCalls: (params: { date?: string; dateFrom?: string; dateTo?: string }) =>
      api.get<{
        calls: any[];
        summary: { total: number; incoming: number; outgoing: number; missed: number; notCalledBack: number };
      }>('/calls', { params }),
    getClientCalls: (clientId: string, params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; total: number }>(`/calls/client/${clientId}`, { params }),
    /**
     * #15 — calls for one client (alias of getClientCalls). Each call carries
     * `recordingUrl`; play it via `getRecordingUrl(url)` which validates the
     * MoiZvonki origin server-side.
     */
    getByClient: (clientId: string, params?: { dateFrom?: string; dateTo?: string }) =>
      api.get<{ calls: any[]; total: number }>(`/calls/client/${clientId}`, { params }),
    getClientSms: (clientId: string) => api.get<any[]>(`/calls/client/${clientId}/sms`),
    getClientSmsHistory: (clientId: string) => api.get<any[]>(`/calls/client/${clientId}/sms`),
    getRecordingUrl: (url: string) => api.get<{ url: string }>('/calls/recording', { params: { url } }),
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
    getByCheck: (checkId: string) => api.get<CheckPhoto[]>(`/check-photos/${checkId}`),
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
    register: (token: string, platform: 'ios' | 'android') => api.post('/push/token', { token, platform }),
    unregister: (token: string) => api.delete('/push/token', { data: { token } } as unknown),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Returns API — full or partial returns of a check.
// ───────────────────────────────────────────────────────────────────────

export function createReturnsApi(api: HttpClient) {
  return {
    list: (params?: { from?: string; to?: string }) => api.get<CheckReturn[]>('/returns', { params }),
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
    update: (data: Partial<ScheduleSettings>) => api.post<ScheduleSettings>('/schedule/settings', data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Employees — extended profile, photo, documents, achievements
// ───────────────────────────────────────────────────────────────────────

export function createEmployeesApi(api: HttpClient) {
  return {
    update: (id: string, body: Partial<EmployeeProfile>) => api.patch<EmployeeProfile>(`/employees/${id}`, body),
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
    documents: (id: string) => api.get<EmployeeDocument[]>(`/employees/${id}/documents`),
    uploadDocument: (id: string, form: unknown) =>
      api.post<EmployeeDocument>(`/employees/${id}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      } as unknown),
    deleteDocument: (id: string, docId: string) => api.delete(`/employees/${id}/documents/${docId}`),
    achievements: (id: string) => api.get<EmployeeAchievement[]>(`/employees/${id}/achievements`),
    addAchievement: (id: string, body: { name: string; description?: string; icon?: string; color?: string }) =>
      api.post<EmployeeAchievement>(`/employees/${id}/achievements`, body),
    removeAchievement: (id: string, achId: string) => api.delete(`/employees/${id}/achievements/${achId}`),
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
        | 'customer_return'
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
    getClientsCarsTemplate: () => api.get<string>('/imports/clients-cars/template', { responseType: 'text' as any }),
    /** Dry-run: validates and groups rows, returns preview without writing. */
    previewClientsCars: (data: ImportPreviewRequest) =>
      api.post<ImportPreviewResponse>('/imports/clients-cars/preview', data, longTimeout),
    /** Commits the import in a transaction. Re-runs validation server-side. */
    confirmClientsCars: (data: ImportConfirmRequest) =>
      api.post<ImportConfirmResponse>('/imports/clients-cars/confirm', data, longTimeout),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Knowledge Base / «База знаний» (063_knowledge_base)
//  READ: any authenticated user. WRITE + acks listing: manager roles only.
// ───────────────────────────────────────────────────────────────────────

export function createKnowledgeApi(api: HttpClient) {
  return {
    // Categories
    listCategories: () => api.get<KnowledgeCategory[]>('/knowledge/categories'),
    createCategory: (data: KnowledgeCategoryInput) => api.post<KnowledgeCategory>('/knowledge/categories', data),
    updateCategory: (id: string, data: Partial<KnowledgeCategoryInput>) =>
      api.patch<KnowledgeCategory>(`/knowledge/categories/${id}`, data),
    deleteCategory: (id: string) => api.delete<{ message: string }>(`/knowledge/categories/${id}`),

    // Global smart search across articles (title + body + block text), category
    // names and course names. Tenant-scoped + ranked. Empty buckets when q < 2 chars.
    search: (q: string) => api.get<KnowledgeSearchResults>('/knowledge/search', { params: { q } }),

    // Articles — list is slim (no body/attachments), getArticle is full.
    listArticles: (params?: ListArticlesParams) => api.get<KnowledgeArticle[]>('/knowledge/articles', { params }),
    getArticle: (id: string) => api.get<KnowledgeArticle>(`/knowledge/articles/${id}`),
    createArticle: (data: KnowledgeArticleInput) => api.post<KnowledgeArticle>('/knowledge/articles', data),
    updateArticle: (id: string, data: KnowledgeArticleInput) =>
      api.patch<KnowledgeArticle>(`/knowledge/articles/${id}`, data),
    deleteArticle: (id: string) => api.delete<{ message: string }>(`/knowledge/articles/${id}`),

    // Acknowledgments
    acknowledge: (id: string) =>
      api.post<{ acknowledgedAt: string | null; version: number }>(`/knowledge/articles/${id}/ack`),
    listAcks: (id: string) => api.get<KnowledgeAcksResponse>(`/knowledge/articles/${id}/acks`),

    // Article feedback (helpful / not-helpful)
    articleFeedback: (id: string, helpful: boolean) =>
      api.post<ArticleFeedbackResult>(`/knowledge/articles/${id}/feedback`, { helpful }),

    // Regulation badge counters
    regulationsPendingCount: () => api.get<{ count: number }>('/knowledge/regulations/pending-count'),
    regulationSummaryForUser: (userId: string) =>
      api.get<RegulationUserSummary>(`/knowledge/regulations/summary-for-user/${userId}`),

    // ─── Учебный центр — courses ───────────────────────────────────────────
    listCourses: () => api.get<KnowledgeCourse[]>('/knowledge/courses'),
    getCourse: (id: string) => api.get<KnowledgeCourse>(`/knowledge/courses/${id}`),
    createCourse: (data: KnowledgeCourseInput) => api.post<KnowledgeCourse>('/knowledge/courses', data),
    updateCourse: (id: string, data: Partial<KnowledgeCourseInput>) =>
      api.patch<KnowledgeCourse>(`/knowledge/courses/${id}`, data),
    deleteCourse: (id: string) => api.delete<{ message: string }>(`/knowledge/courses/${id}`),
    courseProgress: (courseId: string, userId: string) =>
      api.get<CourseProgress>(`/knowledge/courses/${courseId}/progress/${userId}`),

    // ─── Lessons ───────────────────────────────────────────────────────────
    createLesson: (courseId: string, data: KnowledgeLessonInput) =>
      api.post<KnowledgeLesson>(`/knowledge/courses/${courseId}/lessons`, data),
    updateLesson: (id: string, data: Partial<KnowledgeLessonInput>) =>
      api.patch<KnowledgeLesson>(`/knowledge/lessons/${id}`, data),
    deleteLesson: (id: string) => api.delete<{ message: string }>(`/knowledge/lessons/${id}`),
    /** Mark a lesson done. Pass `answers` when the lesson has a quiz (must pass). */
    completeLesson: (id: string, answers?: number[]) =>
      api.post<LessonProgress>(`/knowledge/lessons/${id}/complete`, { answers } as CompleteLessonInput),

    // ─── Troubleshooting (типовые неисправности) ───────────────────────────
    listTroubleshooting: (params?: ListTroubleshootingParams) =>
      api.get<Troubleshooting[]>('/knowledge/troubleshooting', { params }),
    getTroubleshooting: (id: string) => api.get<Troubleshooting>(`/knowledge/troubleshooting/${id}`),
    createTroubleshooting: (data: TroubleshootingInput) =>
      api.post<Troubleshooting>('/knowledge/troubleshooting', data),
    updateTroubleshooting: (id: string, data: Partial<TroubleshootingInput>) =>
      api.patch<Troubleshooting>(`/knowledge/troubleshooting/${id}`, data),
    deleteTroubleshooting: (id: string) => api.delete<{ message: string }>(`/knowledge/troubleshooting/${id}`),

    // ─── Contextual KB ─────────────────────────────────────────────────────
    forCar: (params: ForCarParams) => api.get<KnowledgeForCar>('/knowledge/for-car', { params }),
    listChecklists: () => api.get<KnowledgeArticle[]>('/knowledge/checklists'),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Notifications (066_notification_preferences + 067_notification_broadcasts)
//  preferences: any authenticated user manages their own mute list.
//  broadcasts:  read/seen for any user; createBroadcast is superadmin-only
//               (enforced server-side via @Roles('superadmin')).
// ───────────────────────────────────────────────────────────────────────

export function createNotificationsApi(api: HttpClient) {
  return {
    // Preferences (opt-out: `muted` is the set the user turned OFF).
    getPreferences: () => api.get<NotificationPreferences>('/notifications/preferences'),
    updatePreferences: (muted: NotificationCategory[]) =>
      api.put<NotificationPreferences>('/notifications/preferences', { muted }),

    // Persisted broadcasts — re-fetchable on app open if the push was missed.
    listUnseenBroadcasts: () => api.get<Broadcast[]>('/notifications/broadcasts/unseen'),
    markBroadcastSeen: (id: string) => api.post<{ ok: true }>(`/notifications/broadcasts/${id}/seen`),

    // Superadmin → director broadcast authoring.
    createBroadcast: (payload: CreateBroadcastRequest) => api.post<Broadcast>('/admin/broadcast', payload),

    // Superadmin broadcast cabinet: history (newest-first, with seenCount) and
    // revoke. cancelBroadcast stamps cancelled_at server-side, so the broadcast
    // instantly stops surfacing to EVERY director on their next foreground fetch.
    listBroadcasts: () => api.get<BroadcastHistoryItem[]>('/admin/broadcasts'),
    cancelBroadcast: (id: string) => api.delete<{ ok: true }>(`/admin/broadcast/${id}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Записи (bookings) — internal staff-side appointments.
//  All routes require `bookings_access`; visibility (master=own, admin/owner=
//  all) and ownership are enforced server-side. create/update echo back the
//  booking with an optional non-blocking `conflictWarning`.
// ───────────────────────────────────────────────────────────────────────

export function createBookingsApi(api: HttpClient) {
  return {
    list: (params?: ListBookingsParams) => api.get<Booking[]>('/bookings', { params }),
    create: (data: CreateBookingRequest) => api.post<BookingMutationResult>('/bookings', data),
    update: (id: string, data: UpdateBookingRequest) => api.patch<BookingMutationResult>(`/bookings/${id}`, data),
    cancel: (id: string) => api.post<Booking>(`/bookings/${id}/cancel`),
    convert: (id: string, data: ConvertBookingRequest) => api.post<Booking>(`/bookings/${id}/convert`, data),
    getSettings: () => api.get<BookingSettings>('/bookings/settings'),
    updateSettings: (data: UpdateBookingSettingsRequest) => api.patch<BookingSettings>('/bookings/settings', data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Permission templates («роли») — tenant-defined, reusable permission sets.
//  All routes are director/admin/superadmin-gated and tenant-scoped server-side
//  (same gate as the user permissions editor). `apply` copies a template's
//  permission map onto a user; the server reuses updatePermissions there, so
//  the self-lockout guard (you can't strip your own user_management) applies —
//  apply() echoes back the user's RESULTING permission map.
// ───────────────────────────────────────────────────────────────────────

export function createPermissionTemplatesApi(api: HttpClient) {
  return {
    list: () => api.get<PermissionTemplate[]>('/permission-templates'),
    create: (data: { name: string; permissions: Record<string, boolean> }) =>
      api.post<PermissionTemplate>('/permission-templates', data),
    update: (id: string, data: { name?: string; permissions?: Record<string, boolean> }) =>
      api.patch<PermissionTemplate>(`/permission-templates/${id}`, data),
    remove: (id: string) => api.delete<{ success: true }>(`/permission-templates/${id}`),
    apply: (id: string, userId: string) => api.post<UserPermissions>(`/permission-templates/${id}/apply/${userId}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Кассовая смена / Z-отчёт / Инкассация (cash shift / Z-report / collection).
//  Backend: cash-shifts/ (migration 080). open/close/collect are owner-class
//  gated server-side; current/report/list are readable by any tenant user.
//  Every response carries the recomputed Z-report so the UI updates instantly.
// ───────────────────────────────────────────────────────────────────────

export function createCashShiftsApi(api: HttpClient) {
  return {
    /** Open a shift. 409 if one is already open for the tenant. */
    open: (data: { openingAmount: number; note?: string }) => api.post<CashShiftReport>('/cash-shifts/open', data),
    /** Close the shift; returns the final Z-report with computed difference. */
    close: (id: string, data: { closingAmount: number; note?: string }) =>
      api.post<CashShiftReport>(`/cash-shifts/${id}/close`, data),
    /** The currently-open shift with live Z-report, or null when none is open. */
    current: () => api.get<CashShiftReport | null>('/cash-shifts/current'),
    /** Full Z-report for one shift (live for open, frozen headline for closed). */
    report: (id: string) => api.get<CashShiftReport>(`/cash-shifts/${id}/report`),
    /** Paginated shift history, newest first. */
    list: (params?: { page?: number; limit?: number }) =>
      api.get<PaginatedResponse<CashShift>>('/cash-shifts', { params }),
    /** Record an инкассация; returns the refreshed Z-report. */
    collect: (id: string, data: { amount: number; note?: string }) =>
      api.post<CashShiftReport>(`/cash-shifts/${id}/collect`, data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Дебиторка / долги клиентов (client receivables / debts ledger).
//  Backend: debts/ (migration 081). charge/payment/delete are owner-class
//  gated server-side; client ledger / debtors overview are readable by any
//  tenant user. Every mutation returns the refreshed per-client summary so
//  the UI updates instantly.
// ───────────────────────────────────────────────────────────────────────

export function createDebtsApi(api: HttpClient) {
  return {
    /** Add a 'charge' (client owes more). Returns the refreshed client summary. */
    charge: (data: { clientId: string; amount: number; reason?: string; checkId?: string }) =>
      api.post<ClientDebtSummary>('/debts/charge', data),
    /** Record a repayment. Overpayment allowed → balance may go negative. */
    payment: (data: { clientId: string; amount: number; reason?: string }) =>
      api.post<ClientDebtSummary>('/debts/payment', data),
    /** Per-client balance + ledger (newest-first) + read-only deferred-check context. */
    clientLedger: (clientId: string) => api.get<ClientDebtSummary>(`/debts/client/${clientId}`),
    /** Clients with a positive outstanding balance, ordered by balance desc. */
    debtors: () => api.get<Debtor[]>('/debts/debtors'),
    /** Delete one ledger entry (admin correction). Returns the refreshed summary. */
    remove: (id: string) => api.delete<ClientDebtSummary>(`/debts/${id}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Рассрочка (installments). Backend: installments/ (migration 093). REPLACES
//  the manual «Дебиторка» (debts/) as the primary sell-on-credit flow in the UI.
//
//  There is NO create endpoint: the plan is created server-side by ChecksService
//  when a check is sold with paymentMethod 'installment' (gated by the
//  `sell_installment` permission). This API covers the lifecycle AFTER that —
//  list / pay / payoff / reschedule / client ledger / widget / reminder settings.
//
//  Reads (list / client ledger) are open to any tenant user; pay / payoff /
//  reschedule, the widget, and reminder settings are owner-class gated server-side.
// ───────────────────────────────────────────────────────────────────────

export function createInstallmentsApi(api: HttpClient) {
  return {
    /** «Рассрочка» list. status: open | closed | overdue | all (default open). */
    list: (params?: { status?: 'open' | 'closed' | 'overdue' | 'all' }) =>
      api.get<InstallmentPlan[]>('/installments', { params }),
    /** A client's plans + payment ledger — for the client card section. */
    clientLedger: (clientId: string) => api.get<InstallmentClientLedger>(`/installments/client/${clientId}`),
    /** Главная widget: due-soon (next `days`) + overdue. Owner/admin only. */
    widget: (days?: number) => api.get<InstallmentWidget>('/installments/widget', { params: { days } }),
    /** Record a partial payment; reduces remaining, optionally moves the next date. Returns the updated plan. */
    pay: (planId: string, data: { amount: number; comment?: string; nextPaymentDate?: string }) =>
      api.post<InstallmentPlan>(`/installments/${planId}/pay`, data),
    /** Pay off the whole remaining at once (close the plan). Returns the updated plan. */
    payoff: (planId: string) => api.post<InstallmentPlan>(`/installments/${planId}/payoff`),
    /** Reschedule the next payment date and/or edit the comment. Returns the updated plan. */
    update: (planId: string, data: { nextPaymentDate?: string; comment?: string }) =>
      api.patch<InstallmentPlan>(`/installments/${planId}`, data),
    /** Per-tenant reminder settings (default row auto-created on first read). Owner-class. */
    getReminderSettings: () => api.get<InstallmentReminderSettings>('/installments/reminder-settings'),
    /** Owner-class partial update of the reminder settings. */
    updateReminderSettings: (data: Partial<InstallmentReminderSettings>) =>
      api.patch<InstallmentReminderSettings>('/installments/reminder-settings', data),
    /** Manual «отправить напоминания сейчас» (owner-class). */
    sendReminders: () => api.post<InstallmentReminderSendResult>('/installments/reminders/send'),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Программа лояльности / бонусы / кешбэк (loyalty / bonus / cashback).
//  Backend: loyalty/ (migration 083). settings PATCH + adjust are owner-class
//  gated server-side; accrue/redeem are gated to cashier-capable roles; reads
//  (settings, per-client summary) are open to any tenant user. Every mutation
//  returns the refreshed per-client summary so the UI updates instantly.
//
//  ADDITIVE: this does NOT modify the checks create/update write path — the cash
//  UI calls accrue/redeem explicitly at/after a sale. Apple Wallet is separate.
// ───────────────────────────────────────────────────────────────────────

export function createLoyaltyApi(api: HttpClient) {
  return {
    /** Per-tenant loyalty config (default row auto-created on first read). */
    getSettings: () => api.get<LoyaltySettings>('/loyalty/settings'),
    /** Owner-class partial update of the loyalty config. */
    updateSettings: (data: { enabled?: boolean; accrualPercent?: number; redeemMaxPercent?: number }) =>
      api.patch<LoyaltySettings>('/loyalty/settings', data),
    /** Per-client balance + ledger (newest-first). */
    clientSummary: (clientId: string) => api.get<ClientBonusSummary>(`/loyalty/client/${clientId}`),
    /**
     * Credit bonus. Omit `amount` + pass `checkId` to auto-compute
     * round(checkTotal * accrualPercent / 100). No-op/422 when loyalty disabled.
     */
    accrue: (data: { clientId: string; checkId?: string; amount?: number }) =>
      api.post<ClientBonusSummary>('/loyalty/accrue', data),
    /** Spend bonus. Validated ≤ balance and (with checkId) ≤ checkTotal*redeemMaxPercent/100. */
    redeem: (data: { clientId: string; checkId?: string; amount: number }) =>
      api.post<ClientBonusSummary>('/loyalty/redeem', data),
    /** Owner-class manual correction (accrual/redemption with a required reason). */
    adjust: (data: { clientId: string; amount: number; type: BonusType; reason: string }) =>
      api.post<ClientBonusSummary>('/loyalty/adjust', data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Заказы поставщикам + приёмка (purchase orders + receiving).
//  Backend: purchase-orders/ (migration 084). Reads (list / detail /
//  suggestions) are open to any tenant user; every mutation is owner-class
//  (director / admin / superadmin) server-side.
//
//  Receiving credits stock through the SAME `income` stock-movement path manual
//  receiving uses, transactionally (PO status + stock both succeed or both
//  fail). create / update / order / receive / cancel all return the refreshed
//  full order (header + items) so the UI updates instantly.
// ───────────────────────────────────────────────────────────────────────

export function createPurchaseOrdersApi(api: HttpClient) {
  return {
    /** Paginated list, newest-first. Filter by status and/or supplier. */
    list: (params?: { status?: PurchaseOrderStatus; supplierId?: string; page?: number; limit?: number }) =>
      api.get<PaginatedResponse<PurchaseOrder>>('/purchase-orders', { params }),
    /** Full order: header + items. */
    getById: (id: string) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
    /** Create a draft order (computes total). */
    create: (data: {
      supplierId: string;
      note?: string;
      items: Array<{ productId: string; quantity: number; costPrice: number }>;
    }) => api.post<PurchaseOrder>('/purchase-orders', data),
    /** Edit a draft (items replace the whole set; total recomputed). */
    update: (
      id: string,
      data: {
        supplierId?: string;
        note?: string | null;
        items?: Array<{ productId: string; quantity: number; costPrice: number }>;
      },
    ) => api.patch<PurchaseOrder>(`/purchase-orders/${id}`, data),
    /** draft → ordered. */
    order: (id: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/order`, {}),
    /**
     * Receive (full or partial). Omit `items` to receive the full outstanding
     * quantity of every line; pass `items` to receive deltas on specific lines.
     * Each receipt credits stock via the income path. Fully received ⇒ status
     * 'received'; partial ⇒ stays 'ordered'.
     */
    receive: (id: string, data?: { items?: Array<{ itemId: string; receivedQuantity: number }> }) =>
      api.post<PurchaseOrder>(`/purchase-orders/${id}/receive`, data ?? {}),
    /** Cancel (only if not yet received). */
    cancel: (id: string) => api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {}),
    /** Low-stock products grouped by preferred supplier — prefill a new order. */
    suggestions: () => api.get<PurchaseOrderSuggestionGroup[]>('/purchase-orders/suggestions'),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Эквайринг + СБП (online acquiring + Faster Payments). Backend: payments/
//  (migration 085). Provider-agnostic — ЮKassa real, Tinkoff reserved.
//
//  settings get/update are owner-class (director/admin/superadmin) gated
//  server-side; `create` is gated to the cashier-capable set (the roles that
//  work the cash screen / create checks); `get` (poll) is open to any tenant
//  user, tenant-scoped. The secret key is WRITE-ONLY — getSettings returns only a
//  mask. The webhook is server-only (the acquirer posts to it) and is NOT part of
//  this client API by design.
//
//  INERT until configured: `create` returns 422 until the owner enters real
//  ЮKassa shopId + secretKey AND flips `enabled` on. Nothing charges before that.
// ───────────────────────────────────────────────────────────────────────

export function createPaymentsApi(api: HttpClient) {
  return {
    /** Masked per-tenant acquiring config. Owner-class. Never returns the raw key. */
    getSettings: () => api.get<PaymentIntegrationSettings>('/payments/settings'),
    /**
     * Owner-class partial update. Send `secretKey` only when (re)entering a key —
     * an omitted/empty key leaves the stored secret untouched (the form shows a
     * mask, not the real value).
     */
    updateSettings: (data: {
      provider?: PaymentProviderName;
      enabled?: boolean;
      shopId?: string;
      secretKey?: string;
    }) => api.patch<PaymentIntegrationSettings>('/payments/settings', data),
    /**
     * Create an online payment. 422 when acquiring is disabled/unconfigured.
     * SBP → response carries `qr` (the СБП-QR payload); card → `confirmationUrl`
     * (redirect). Poll `get(id)` until status leaves 'pending'.
     */
    create: (data: {
      amount: number;
      description?: string;
      method?: AcquiringMethod;
      checkId?: string;
      returnUrl?: string;
    }) => api.post<Payment>('/payments/create', data),
    /** Poll one payment's status (tenant-scoped). Re-syncs pending from provider. */
    get: (id: string) => api.get<Payment>(`/payments/${id}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Онлайн-касса / фискализация 54-ФЗ. Backend: fiscal/ (migration 086).
//  Provider-agnostic — АТОЛ Онлайн (ATOL Online v4) is implemented for real.
//
//  settings get/update are owner-class (director/admin/superadmin) gated
//  server-side; `fiscalize` is gated to the cashier-capable set (the roles that
//  work the cash screen / close checks); `getReceipt` (poll) is open to any tenant
//  user, tenant-scoped. The АТОЛ password is WRITE-ONLY — getSettings returns only
//  a mask. АТОЛ is poll-based, so there is NO webhook in this client API.
//
//  INERT until configured: `fiscalize` returns 422 until the owner enters real
//  АТОЛ login + password + group_code AND flips `enabled` on. Nothing fiscalizes
//  before that. The receipt itself is built SERVER-SIDE from the check — the
//  client only supplies where to send it (email/phone).
// ───────────────────────────────────────────────────────────────────────

export function createFiscalApi(api: HttpClient) {
  return {
    /** Masked per-tenant АТОЛ config. Owner-class. Never returns the raw password. */
    getSettings: () => api.get<FiscalSettings>('/fiscal/settings'),
    /**
     * Owner-class partial update. Send `password` only when (re)entering it — an
     * omitted/empty password leaves the stored secret untouched (the form shows a
     * mask, not the real value).
     */
    updateSettings: (data: {
      provider?: FiscalProviderName;
      enabled?: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    }) => api.patch<FiscalSettings>('/fiscal/settings', data),
    /**
     * Fiscalize a closed check (заказ-наряд). 422 when the kassa is disabled/
     * unconfigured. The receipt is built server-side from the check; pass `email`
     * and/or `phone` for the electronic receipt (≥1 required by 54-ФЗ — falls back
     * to the check's client phone). Poll `getReceipt(checkId)` until status leaves
     * 'pending'.
     */
    fiscalize: (data: { checkId: string; email?: string; phone?: string }) =>
      api.post<FiscalReceipt>('/fiscal/fiscalize', data),
    /**
     * Latest fiscal receipt for a check (tenant-scoped). Re-syncs a 'pending'
     * receipt straight from the operator (АТОЛ is poll-based). 404 until the check
     * has been fiscalized at least once.
     */
    getReceipt: (checkId: string) => api.get<FiscalReceipt>(`/fiscal/receipt/${checkId}`),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Телефония (Mango Office). Backend: telephony/ (migration 088).
//  Provider-agnostic VPBX call-event ingestion.
//
//  getSettings/updateSettings are owner-class (director/admin/superadmin) gated
//  server-side. The Mango api_key / api_salt are WRITE-ONLY — getSettings returns
//  only masks + "configured" flags. The callback webhook is server-only (Mango
//  POSTs to a PUBLIC, signature-verified route) and is intentionally NOT part of
//  this client API.
//
//  INERT until configured: nothing is matched/persisted/pushed until the owner
//  enters the real Mango vpbx api key + salt AND flips `enabled` on. Incoming and
//  missed calls then show up in the existing calls list (callsApi.getCalls) and a
//  push is sent to staff the moment the phone rings.
// ───────────────────────────────────────────────────────────────────────

export function createTelephonyApi(api: HttpClient) {
  return {
    /** Masked per-tenant telephony config. Owner-class. Never returns the raw secrets. */
    getSettings: () => api.get<TelephonySettings>('/telephony/settings'),
    /**
     * Owner-class partial update. Send `apiKey` / `apiSalt` only when (re)entering a
     * value — an omitted/empty field leaves the stored secret untouched (the form
     * shows a mask, not the real value).
     */
    updateSettings: (data: {
      provider?: TelephonyProviderName;
      enabled?: boolean;
      apiKey?: string;
      apiSalt?: string;
    }) => api.patch<TelephonySettings>('/telephony/settings', data),
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Apple Wallet — карта лояльности (.pkpass). Backend: wallet/ (migration 089).
//  A storeCard pass with the client's bonus balance (read from loyalty/) and a QR
//  encoding the clientId. Built + PKCS#7-signed SERVER-SIDE (passkit-generator) with
//  the tenant's Apple Pass Type ID certificate.
//
//  getSettings/updateSettings are owner-class (director/admin/superadmin) gated
//  server-side. The signing material (certPem / certKeyPem / certKeyPassword /
//  wwdrPem) is WRITE-ONLY — getSettings returns ONLY boolean "stored" flags, NEVER
//  any PEM. Send a cert field only when (re)uploading it; an omitted/empty field
//  leaves the stored value untouched.
//
//  INERT until configured: getPass returns 422 until the owner uploads a real Pass
//  Type ID cert + key + Apple WWDR cert AND flips `enabled` on. Use
//  WalletSettings.configured to decide whether to show the «Добавить в Apple Wallet»
//  button.
//
//  The pass download is BINARY (application/vnd.apple.pkpass): `getPass(clientId)`
//  returns it as a blob (responseType:'blob') — the mobile app hands the bytes to
//  Wallet, the web can offer it as a download. `passPath(clientId)` exposes the raw
//  authenticated path for callers that prefer to fetch it themselves.
// ───────────────────────────────────────────────────────────────────────

export function createWalletApi(api: HttpClient) {
  return {
    /** Masked per-tenant Apple Wallet config. Owner-class. Never returns raw PEM. */
    getSettings: () => api.get<WalletSettings>('/wallet/settings'),
    /**
     * Owner-class partial update. Send certPem / certKeyPem / certKeyPassword /
     * wwdrPem ONLY when (re)uploading — an omitted/empty field leaves the stored
     * secret untouched (the form shows a flag, not the real PEM).
     */
    updateSettings: (data: {
      enabled?: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    }) => api.patch<WalletSettings>('/wallet/settings', data),
    /**
     * Download the signed .pkpass for a client (tenant-scoped, JWT-authenticated).
     * Resolves to a binary blob (application/vnd.apple.pkpass). 422 when Wallet is
     * disabled/unconfigured, 404 when the client is not in this tenant.
     */
    getPass: (clientId: string) => api.get(`/wallet/pass/${clientId}`, { responseType: 'blob' }),
    /** Raw authenticated path of the .pkpass endpoint (for custom fetch / download flows). */
    passPath: (clientId: string) => `/wallet/pass/${clientId}`,
  };
}
