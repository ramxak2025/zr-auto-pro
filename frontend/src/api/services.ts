import api from './axios';

// Auth
export const authApi = {
  login: (data: { phone: string; password: string }) => api.post('/auth/login', data),
  register: (data: any) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

// Users
export const usersApi = {
  getAll: (params?: any) => api.get('/users', { params }),
  getMasters: (params?: any) => api.get('/users/masters', { params }),
  getById: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data),
  remove: (id: string) => api.delete(`/users/${id}`),
};

// Tenants
export const tenantsApi = {
  getAll: () => api.get('/tenants'),
  getStats: () => api.get('/tenants/stats'),
  getById: (id: string) => api.get(`/tenants/${id}`),
  create: (data: any) => api.post('/tenants', data),
  update: (id: string, data: any) => api.patch(`/tenants/${id}`, data),
  remove: (id: string) => api.delete(`/tenants/${id}`),
};

// Plans
export const plansApi = {
  getAll: () => api.get('/plans'),
  create: (data: any) => api.post('/plans', data),
  update: (id: string, data: any) => api.patch(`/plans/${id}`, data),
  remove: (id: string) => api.delete(`/plans/${id}`),
};

// Subscription
export const subscriptionApi = {
  get: () => api.get('/subscription'),
};

// Clients
export const clientsApi = {
  getAll: (params?: any) => api.get('/clients', { params }),
  getById: (id: string) => api.get(`/clients/${id}`),
  create: (data: any) => api.post('/clients', data),
  update: (id: string, data: any) => api.patch(`/clients/${id}`, data),
  remove: (id: string) => api.delete(`/clients/${id}`),
};

// Cars
export const carsApi = {
  getAll: (params?: any) => api.get('/cars', { params }),
  getById: (id: string) => api.get(`/cars/${id}`),
  create: (data: any) => api.post('/cars', data),
  update: (id: string, data: any) => api.patch(`/cars/${id}`, data),
  remove: (id: string) => api.delete(`/cars/${id}`),
};

// Products
export const productsApi = {
  getAll: (params?: any) => api.get('/products', { params }),
  getLowStock: () => api.get('/products/low-stock'),
  getMovements: (params?: any) => api.get('/products/movements', { params }),
  getById: (id: string) => api.get(`/products/${id}`),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.patch(`/products/${id}`, data),
  remove: (id: string) => api.delete(`/products/${id}`),
  updateStock: (id: string, data: any) => api.post(`/products/${id}/stock`, data),
};

// Services
export const servicesApi = {
  getAll: (params?: any) => api.get('/services', { params }),
  getById: (id: string) => api.get(`/services/${id}`),
  create: (data: any) => api.post('/services', data),
  update: (id: string, data: any) => api.patch(`/services/${id}`, data),
  remove: (id: string) => api.delete(`/services/${id}`),
};

// Checks
export const checksApi = {
  getAll: (params?: any) => api.get('/checks', { params }),
  getDashboard: () => api.get('/checks/dashboard'),
  getRanking: () => api.get('/checks/ranking'),
  getById: (id: string) => api.get(`/checks/${id}`),
  create: (data: any) => api.post('/checks', data),
  update: (id: string, data: any) => api.patch(`/checks/${id}`, data),
  remove: (id: string) => api.delete(`/checks/${id}`),
};

// Suppliers
export const suppliersApi = {
  getAll: (params?: any) => api.get('/suppliers', { params }),
  getById: (id: string) => api.get(`/suppliers/${id}`),
  create: (data: any) => api.post('/suppliers', data),
  update: (id: string, data: any) => api.patch(`/suppliers/${id}`, data),
  remove: (id: string) => api.delete(`/suppliers/${id}`),
  getDeliveries: (params?: any) => api.get('/suppliers/deliveries', { params }),
  createDelivery: (data: any) => api.post('/suppliers/deliveries', data),
  getDeliveryById: (id: string) => api.get(`/suppliers/deliveries/${id}`),
  getPayments: (params?: any) => api.get('/suppliers/payments', { params }),
  createPayment: (data: any) => api.post('/suppliers/payments', data),
};

// Salary
export const salaryApi = {
  getAll: (params?: any) => api.get('/salary', { params }),
  getMy: () => api.get('/salary/my'),
};

// Reports
export const reportsApi = {
  getFinancial: (params: any) => api.get('/reports/financial', { params }),
  getCashFlow: (params: any) => api.get('/reports/cashflow', { params }),
};

// Shifts
export const shiftsApi = {
  getAll: (params?: any) => api.get('/shifts', { params }),
  getMy: () => api.get('/shifts/my'),
  open: (data?: any) => api.post('/shifts/open', data),
  close: (id: string) => api.post(`/shifts/${id}/close`),
};

// Schedule
export const scheduleApi = {
  getAll: (params: any) => api.get('/schedule', { params }),
  create: (data: any) => api.post('/schedule', data),
  update: (id: string, data: any) => api.patch(`/schedule/${id}`, data),
  remove: (id: string) => api.delete(`/schedule/${id}`),
  getWorkModes: () => api.get('/schedule/work-modes'),
  createWorkMode: (data: any) => api.post('/schedule/work-modes', data),
  updateWorkMode: (id: string, data: any) => api.patch(`/schedule/work-modes/${id}`, data),
  getToday: () => api.get('/schedule/today'),
  getMyStats: () => api.get('/schedule/my-stats'),
};

// Uploads
export const uploadsApi = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
