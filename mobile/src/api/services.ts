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
} from '../../../shared/api/createServices';

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

// Platform-specific upload for React Native
export const uploadsApi = {
  upload: async (uri: string, filename: string) => {
    const fd = new FormData();
    fd.append('file', {
      uri,
      name: filename || 'photo.jpg',
      type: 'image/jpeg',
    } as any);
    return api.post<{ url: string; thumbnail: string; filename: string; originalname: string; size: number }>('/uploads', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
