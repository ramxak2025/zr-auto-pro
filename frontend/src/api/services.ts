import api from './axios';
import type {
  User,
  Tenant,
  Plan,
  Client,
  Car,
  Product,
  Service,
  Check,
  Supplier,
  Delivery,
  SupplierPayment,
  MasterSalary,
  SalarySummary,
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
  TodayEmployeeStatus,
  MarketingDashboard,
  ReviewResponse,
  ReviewAlert,
  MessagingIntegration,
  ReviewPlatformLink,
  ReviewSettings,
  PublicReviewData,
} from '../types';

// --- Request types ---

interface LoginRequest {
  phone: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

interface RegisterRequest {
  phone: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

interface ChecksParams extends PaginationParams {
  masterId?: string;
  clientId?: string;
  carId?: string;
  dateFrom?: string;
  dateTo?: string;
  retail?: string;
}

interface DateRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

interface CreateUserRequest {
  phone: string;
  password: string;
  fullName: string;
  role: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
}

interface UpdateUserRequest {
  phone?: string;
  password?: string;
  fullName?: string;
  role?: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
  daysOff?: number[];
  isActive?: boolean;
}

interface CreateClientRequest {
  fullName: string;
  phone: string;
  comment?: string;
}

interface UpdateClientRequest {
  fullName?: string;
  phone?: string;
  comment?: string;
}

interface CreateCarRequest {
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
}

interface UpdateCarRequest {
  plateNumber?: string;
  makeModel?: string;
  comment?: string;
  clientId?: string;
}

interface CreateProductRequest {
  name: string;
  category?: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
}

interface UpdateProductRequest {
  name?: string;
  category?: string;
  photo?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  minStock?: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
}

interface StockUpdateRequest {
  type: 'income' | 'expense' | 'writeoff' | 'inventory';
  quantity: number;
  reason?: string;
}

interface CreateServiceRequest {
  name: string;
  category?: string;
  defaultPrice: number;
}

interface UpdateServiceRequest {
  name?: string;
  category?: string;
  defaultPrice?: number;
}

interface CreateCheckRequest {
  date?: string;
  masterId: string;
  clientId: string;
  carId: string;
  mileage?: number;
  comment?: string;
  discount?: number;
  isDeferred?: boolean;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  services: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

interface UpdateCheckRequest {
  date?: string;
  paymentMethod?: string;
  isDeferred?: boolean;
  comment?: string;
  cashAmount?: number;
  cardAmount?: number;
  clientId?: string;
  carId?: string;
  masterId?: string;
  mileage?: number;
  discount?: number;
  services?: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products?: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

interface CreateSupplierRequest {
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

interface UpdateSupplierRequest {
  name?: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

interface CreateDeliveryRequest {
  supplierId: string;
  date?: string;
  comment?: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

interface CreatePaymentRequest {
  supplierId: string;
  amount: number;
  date?: string;
  comment?: string;
}

interface CreateScheduleRequest {
  userId: string;
  date: string;
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

interface UpdateScheduleRequest {
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

interface CreateWorkModeRequest {
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays?: number[];
  shiftStart: string;
  shiftEnd: string;
}

interface UpdateWorkModeRequest {
  name?: string;
  type?: string;
  shiftStart?: string;
  shiftEnd?: string;
}

interface CreateTenantRequest {
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  maxUsers?: number;
  isActive?: boolean;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
  directorName?: string;
  directorPhone?: string;
  directorPassword?: string;
}

interface UpdateTenantRequest {
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  isActive?: boolean;
  maxUsers?: number;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
}

interface CreatePlanRequest {
  name: string;
  monthlyPrice: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  sortOrder?: number;
}

interface UpdatePlanRequest {
  name?: string;
  monthlyPrice?: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  isActive?: boolean;
  sortOrder?: number;
}

// --- API modules ---

export const authApi = {
  login: (data: LoginRequest) => api.post<LoginResponse>('/auth/login', data),
  register: (data: RegisterRequest) => api.post<LoginResponse>('/auth/register', data),
  me: () => api.get<User>('/auth/me'),
  updateAvatar: (avatar: string) => api.patch<{ avatar: string }>('/auth/avatar', { avatar }),
};

export const usersApi = {
  getAll: (params?: PaginationParams) => api.get<User[]>('/users', { params }),
  getMasters: (params?: PaginationParams) => api.get<User[]>('/users/masters', { params }),
  getById: (id: string) => api.get<User>(`/users/${id}`),
  create: (data: CreateUserRequest) => api.post<User>('/users', data),
  update: (id: string, data: UpdateUserRequest) => api.patch<User>(`/users/${id}`, data),
  remove: (id: string) => api.delete(`/users/${id}`),
};

export const tenantsApi = {
  getAll: () => api.get<Tenant[]>('/tenants'),
  getStats: () => api.get<PlatformStats>('/tenants/stats'),
  getById: (id: string) => api.get<Tenant>(`/tenants/${id}`),
  create: (data: CreateTenantRequest) => api.post<Tenant>('/tenants', data),
  update: (id: string, data: UpdateTenantRequest) => api.patch<Tenant>(`/tenants/${id}`, data),
  remove: (id: string) => api.delete(`/tenants/${id}`),
};

export const plansApi = {
  getAll: () => api.get<Plan[]>('/plans'),
  create: (data: CreatePlanRequest) => api.post<Plan>('/plans', data),
  update: (id: string, data: UpdatePlanRequest) => api.patch<Plan>(`/plans/${id}`, data),
  remove: (id: string) => api.delete(`/plans/${id}`),
};

export const subscriptionApi = {
  get: () => api.get<SubscriptionInfo>('/subscription'),
};

export const clientsApi = {
  getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Client>>('/clients', { params }),
  getById: (id: string) => api.get<Client>(`/clients/${id}`),
  create: (data: CreateClientRequest) => api.post<Client>('/clients', data),
  update: (id: string, data: UpdateClientRequest) => api.patch<Client>(`/clients/${id}`, data),
  remove: (id: string) => api.delete(`/clients/${id}`),
  exportCsv: () => api.get('/clients/export-csv', { responseType: 'blob' }),
};

export const carsApi = {
  getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Car>>('/cars', { params }),
  getById: (id: string) => api.get<Car>(`/cars/${id}`),
  create: (data: CreateCarRequest) => api.post<Car>('/cars', data),
  update: (id: string, data: UpdateCarRequest) => api.patch<Car>(`/cars/${id}`, data),
  remove: (id: string) => api.delete(`/cars/${id}`),
};

export const productsApi = {
  getAll: (params?: PaginationParams) => api.get<PaginatedResponse<Product>>('/products', { params }),
  getLowStock: () => api.get<Product[]>('/products/low-stock'),
  getMovements: (params?: PaginationParams) => api.get<StockMovement[]>('/products/movements', { params }),
  getWarehouseStats: () => api.get<{ totalCostValue: number; totalSellValue: number; totalItems: number; monthProductCost: number; lastMonthProductCost: number }>('/products/warehouse-stats'),
  getById: (id: string) => api.get<Product>(`/products/${id}`),
  create: (data: CreateProductRequest) => api.post<Product>('/products', data),
  update: (id: string, data: UpdateProductRequest) => api.patch<Product>(`/products/${id}`, data),
  remove: (id: string) => api.delete(`/products/${id}`),
  updateStock: (id: string, data: StockUpdateRequest) => api.post<{ stock: number }>(`/products/${id}/stock`, data),
};

export const servicesApi = {
  getAll: (params?: PaginationParams & { category?: string }) => api.get<PaginatedResponse<Service>>('/services', { params }),
  getById: (id: string) => api.get<Service>(`/services/${id}`),
  create: (data: CreateServiceRequest) => api.post<Service>('/services', data),
  update: (id: string, data: UpdateServiceRequest) => api.patch<Service>(`/services/${id}`, data),
  remove: (id: string) => api.delete(`/services/${id}`),
};

export const checksApi = {
  getAll: (params?: ChecksParams) => api.get<PaginatedResponse<Check>>('/checks', { params }),
  getDashboard: () => api.get<DashboardStats>('/checks/dashboard'),
  getDashboardChart: (period: string, offset?: number) => api.get<{ points: Array<{ date: string; revenue: number; profit: number; checkCount: number }>; totalRevenue: number; totalProfit: number; totalChecks: number }>('/checks/dashboard/chart', { params: { period, offset: offset ?? 0 } }),
  getRanking: () => api.get<EmployeeRanking>('/checks/ranking'),
  getById: (id: string) => api.get<Check>(`/checks/${id}`),
  create: (data: CreateCheckRequest) => api.post<Check>('/checks', data),
  update: (id: string, data: UpdateCheckRequest) => api.patch<Check>(`/checks/${id}`, data),
  remove: (id: string) => api.delete(`/checks/${id}`),
};

export const suppliersApi = {
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

export const salaryApi = {
  getAll: (params?: DateRangeParams) => api.get<MasterSalary[]>('/salary', { params }),
  getMy: () => api.get<SalarySummary>('/salary/my'),
};

export const reportsApi = {
  getFinancial: (params: DateRangeParams) => api.get<FinancialReport>('/reports/financial', { params }),
  getCashFlow: (params: DateRangeParams) => api.get<{ days: Array<{ date: string; cash: number; card: number; warranty: number; total: number }>; totals: { cash: number; card: number; warranty: number; total: number } }>('/reports/cashflow', { params }),
};

export const shiftsApi = {
  getAll: (params?: PaginationParams) => api.get<Shift[]>('/shifts', { params }),
  getMy: () => api.get<Shift[]>('/shifts/my'),
  open: (data?: Record<string, unknown>) => api.post<Shift>('/shifts/open', data),
  close: (id: string) => api.post<Shift>(`/shifts/${id}/close`),
};

export const scheduleApi = {
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

export const expensesApi = {
  getCategories: () => api.get<Array<{ id: string; name: string }>>('/expenses/categories'),
  createCategory: (data: { name: string }) => api.post('/expenses/categories', data),
  removeCategory: (id: string) => api.delete(`/expenses/categories/${id}`),
  getAll: (params?: DateRangeParams) => api.get<Array<{ id: string; categoryId?: string; categoryName?: string; amount: number; description?: string; date: string; userId?: string; userName?: string; createdAt: string }>>('/expenses', { params }),
  create: (data: { categoryId?: string; amount: number; description?: string; date?: string }) => api.post('/expenses', data),
  remove: (id: string) => api.delete(`/expenses/${id}`),
};

export const warehouseCategoriesApi = {
  getAll: () => api.get<Array<{ id: string; path: string }>>('/warehouse/categories'),
  create: (path: string) => api.post<{ id: string; path: string }>('/warehouse/categories', { path }),
  remove: (id: string) => api.delete(`/warehouse/categories/${id}`),
};

// Compress image client-side before upload (faster transfer, less storage)
async function compressImage(file: File, maxWidth = 1200, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 200 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, maxWidth / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export const uploadsApi = {
  upload: async (file: File) => {
    const compressed = await compressImage(file);
    const fd = new FormData();
    fd.append('file', compressed);
    return api.post<{ url: string; thumbnail: string; filename: string; originalname: string; size: number }>('/uploads', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const marketingApi = {
  getDashboard: () => api.get<MarketingDashboard>('/marketing/dashboard'),
  getReviews: (params?: { employeeId?: string; minRating?: number; maxRating?: number }) => api.get<ReviewResponse[]>('/marketing/reviews', { params }),
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
};

export const publicReviewApi = {
  getByToken: (token: string) => api.get<PublicReviewData>(`/marketing/review/${token}`),
  submit: (token: string, data: { rating: number; comment?: string; redirectedTo?: string }) => api.post<{ success: boolean }>(`/marketing/review/${token}`, data),
};
