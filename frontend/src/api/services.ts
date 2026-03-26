import api from './axios';
import {
  createAuthApi,
  createUsersApi,
  createTenantsApi,
  createMyCompanyApi,
  createPlansApi,
  createSubscriptionApi,
  createClientsApi,
  createCarsApi,
  createProductsApi,
  createServicesApi,
  createChecksApi,
  createSuppliersApi,
  createSalaryApi,
  createReportsApi,
  createShiftsApi,
  createScheduleApi,
  createExpensesApi,
  createWarehouseCategoriesApi,
  createMarketingApi,
  createPublicReviewApi,
  createCallsApi,
} from '../../../shared/api/createServices';

// Re-export all API request types for any file that imports them from here
export type {
  LoginRequest, LoginResponse, RegisterRequest, PaginationParams,
  ChecksParams, DateRangeParams, CreateUserRequest, UpdateUserRequest,
  CreateClientRequest, UpdateClientRequest, CreateCarRequest, UpdateCarRequest,
  CreateProductRequest, UpdateProductRequest, StockUpdateRequest,
  CreateServiceRequest, UpdateServiceRequest, CreateCheckRequest, UpdateCheckRequest,
  CreateSupplierRequest, UpdateSupplierRequest, CreateDeliveryRequest,
  CreatePaymentRequest, CreateScheduleRequest, UpdateScheduleRequest,
  CreateWorkModeRequest, UpdateWorkModeRequest, CreateTenantRequest,
  UpdateTenantRequest, CreatePlanRequest, UpdatePlanRequest,
} from '../../../shared/api/types';

// --- Instantiate all API modules with the platform-specific axios instance ---

export const authApi = createAuthApi(api);
export const usersApi = createUsersApi(api);
export const tenantsApi = createTenantsApi(api);
export const myCompanyApi = createMyCompanyApi(api);
export const plansApi = createPlansApi(api);
export const subscriptionApi = createSubscriptionApi(api);
export const clientsApi = createClientsApi(api);
export const carsApi = createCarsApi(api);
export const productsApi = createProductsApi(api);
export const servicesApi = createServicesApi(api);
export const checksApi = createChecksApi(api);
export const suppliersApi = createSuppliersApi(api);
export const salaryApi = createSalaryApi(api);
export const reportsApi = createReportsApi(api);
export const shiftsApi = createShiftsApi(api);
export const scheduleApi = createScheduleApi(api);
export const expensesApi = createExpensesApi(api);
export const warehouseCategoriesApi = createWarehouseCategoriesApi(api);
export const marketingApi = createMarketingApi(api);
export const publicReviewApi = createPublicReviewApi(api);
export const callsApi = createCallsApi(api);

// --- Platform-specific: Image compression + Upload (uses Canvas API) ---

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
