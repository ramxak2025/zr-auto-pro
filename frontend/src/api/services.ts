import api from './axios';
import type {
  User,
  Tenant,
  PlatformStats,
  Client,
  Car,
  Product,
  Service,
  Check,
  Supplier,
  Delivery,
  SupplierPayment,
  StockMovement,
  PaginatedResponse,
  FinancialReport,
  MasterSalary,
  SalarySummary,
  DashboardStats,
  EmployeeRanking,
  Shift,
  ScheduleEntry,
  WorkMode,
  TodayEmployeeStatus,
} from '../types';

// Auth
export const authApi = {
  login: (data: { username: string; password: string }) =>
    api.post<{ access_token: string; user: User }>('/auth/login', data),
  register: (data: { username: string; password: string; fullName: string; role: string; salaryPercent?: number }) =>
    api.post<User>('/auth/register', data),
  getProfile: () => api.get<User>('/auth/profile'),
};

// Admin - Tenants (SuperAdmin only)
export const adminApi = {
  getTenants: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Tenant>>('/admin/tenants', { params }),
  getTenant: (id: string) => api.get<Tenant>(`/admin/tenants/${id}`),
  getStats: () => api.get<PlatformStats>('/admin/tenants/stats'),
  createTenant: (data: any) => api.post<Tenant>('/admin/tenants', data),
  updateTenant: (id: string, data: any) => api.patch<Tenant>(`/admin/tenants/${id}`, data),
  activateTenant: (id: string) => api.post(`/admin/tenants/${id}/activate`),
  deactivateTenant: (id: string) => api.post(`/admin/tenants/${id}/deactivate`),
  extendSubscription: (id: string, data: { subscriptionEnd: string; note?: string }) =>
    api.post<Tenant>(`/admin/tenants/${id}/extend-subscription`, data),
  deleteTenant: (id: string) => api.delete(`/admin/tenants/${id}`),
};

// Users
export const usersApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<User>>('/users', { params }),
  getMasters: () => api.get<User[]>('/users/masters'),
  getById: (id: string) => api.get<User>(`/users/${id}`),
  create: (data: any) => api.post<User>('/users', data),
  update: (id: string, data: any) => api.patch<User>(`/users/${id}`, data),
  updatePermissions: (id: string, data: any) =>
    api.patch<User>(`/users/${id}/permissions`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};

// Clients
export const clientsApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Client>>('/clients', { params }),
  getById: (id: string) => api.get<Client>(`/clients/${id}`),
  getStats: (id: string) => api.get<{ totalPayments: number }>(`/clients/${id}/stats`),
  create: (data: any) => api.post<Client>('/clients', data),
  update: (id: string, data: any) => api.patch<Client>(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
};

// Cars
export const carsApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Car>>('/cars', { params }),
  getById: (id: string) => api.get<Car>(`/cars/${id}`),
  create: (data: any) => api.post<Car>('/cars', data),
  update: (id: string, data: any) => api.patch<Car>(`/cars/${id}`, data),
  delete: (id: string) => api.delete(`/cars/${id}`),
};

// Products
export const productsApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Product>>('/products', { params }),
  getById: (id: string) => api.get<Product>(`/products/${id}`),
  getCategories: () => api.get<string[]>('/products/categories'),
  getLowStock: () => api.get<Product[]>('/products/low-stock'),
  getMovements: (id: string, params?: Record<string, any>) =>
    api.get<PaginatedResponse<StockMovement>>(`/products/${id}/movements`, { params }),
  create: (data: any) => api.post<Product>('/products', data),
  update: (id: string, data: any) => api.patch<Product>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  writeoff: (id: string, data: { quantity: number; reason: string }) =>
    api.post(`/products/${id}/writeoff`, data),
  inventory: (id: string, data: { actualStock: number; reason: string }) =>
    api.post(`/products/${id}/inventory`, data),
};

// Services
export const servicesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Service>>('/services', { params }),
  getById: (id: string) => api.get<Service>(`/services/${id}`),
  getCategories: () => api.get<string[]>('/services/categories'),
  create: (data: any) => api.post<Service>('/services', data),
  update: (id: string, data: any) => api.patch<Service>(`/services/${id}`, data),
  delete: (id: string) => api.delete(`/services/${id}`),
};

// Checks
export const checksApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Check>>('/checks', { params }),
  getById: (id: string) => api.get<Check>(`/checks/${id}`),
  create: (data: any) => api.post<Check>('/checks', data),
  update: (id: string, data: any) => api.patch<Check>(`/checks/${id}`, data),
  delete: (id: string) => api.delete(`/checks/${id}`),
  getPrintUrl: (id: string) => `/api/checks/${id}/print`,
};

// Salary
export const salaryApi = {
  getMySummary: () => api.get<SalarySummary>('/salary/my'),
  getMyDetails: (params?: Record<string, any>) =>
    api.get('/salary/my/details', { params }),
  getAllMasters: (params?: Record<string, any>) =>
    api.get<MasterSalary[]>('/salary/masters', { params }),
  getMaster: (id: string) =>
    api.get<SalarySummary>(`/salary/masters/${id}`),
  getMasterDetails: (id: string, params?: Record<string, any>) =>
    api.get(`/salary/masters/${id}/details`, { params }),
};

// Suppliers
export const suppliersApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Supplier>>('/suppliers', { params }),
  getById: (id: string) => api.get<Supplier>(`/suppliers/${id}`),
  create: (data: any) => api.post<Supplier>('/suppliers', data),
  update: (id: string, data: any) => api.patch<Supplier>(`/suppliers/${id}`, data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
  getDeliveries: (id: string, params?: Record<string, any>) =>
    api.get<PaginatedResponse<Delivery>>(`/suppliers/${id}/deliveries`, { params }),
  createDelivery: (id: string, data: any) =>
    api.post<Delivery>(`/suppliers/${id}/deliveries`, data),
  getPayments: (id: string, params?: Record<string, any>) =>
    api.get<PaginatedResponse<SupplierPayment>>(`/suppliers/${id}/payments`, { params }),
  createPayment: (id: string, data: any) =>
    api.post<SupplierPayment>(`/suppliers/${id}/payments`, data),
};

// Uploads
export const uploadsApi = {
  upload: (file: File, folder?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ url: string }>(
      `/uploads${folder ? `?folder=${folder}` : ''}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
};

// Reports
export const reportsApi = {
  getFinancial: (params: Record<string, any>) =>
    api.get<FinancialReport>('/reports/financial', { params }),
  getByMaster: (params: Record<string, any>) =>
    api.get('/reports/by-master', { params }),
  getByService: (params: Record<string, any>) =>
    api.get('/reports/by-service', { params }),
  getByProduct: (params: Record<string, any>) =>
    api.get('/reports/by-product', { params }),
  getDashboard: () => api.get<DashboardStats>('/reports/dashboard'),
  getEmployeeRanking: () => api.get<EmployeeRanking>('/reports/employee-ranking'),
};

// Shifts
export const shiftsApi = {
  openShift: () => api.post<Shift>('/shifts/open'),
  closeShift: (note?: string) => api.post<Shift>('/shifts/close', { note }),
  getMyShift: () => api.get<Shift | null>('/shifts/my'),
  getTodayShifts: () => api.get<Shift[]>('/shifts/today'),
  getHistory: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Shift>>('/shifts/history', { params }),
};

// Schedule
export const scheduleApi = {
  getSchedule: (params: { dateFrom: string; dateTo: string; userId?: string }) =>
    api.get<ScheduleEntry[]>('/schedule', { params }),
  getTodayStatus: () => api.get<TodayEmployeeStatus[]>('/schedule/today-status'),
  createEntry: (data: any) => api.post<ScheduleEntry>('/schedule/entry', data),
  updateEntry: (id: string, data: any) => api.patch<ScheduleEntry>(`/schedule/entry/${id}`, data),
  generateSchedule: (data: {
    userId: string;
    workModeId: string;
    dateFrom: string;
    dateTo: string;
    startOffset?: number;
  }) => api.post<ScheduleEntry[]>('/schedule/generate', data),
  getWorkModes: () => api.get<WorkMode[]>('/schedule/work-modes'),
  createWorkMode: (data: any) => api.post<WorkMode>('/schedule/work-modes', data),
  updateWorkMode: (id: string, data: any) =>
    api.patch<WorkMode>(`/schedule/work-modes/${id}`, data),
  deleteWorkMode: (id: string) => api.delete(`/schedule/work-modes/${id}`),
};
