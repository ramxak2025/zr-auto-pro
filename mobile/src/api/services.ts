import api from './axios';
import {
  createAuthApi,
  createUsersApi,
  createTenantsApi,
  createAdminApi,
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
  createEquipmentApi,
  createWarehousesApi,
  createWarrantyApi,
  createStockMovementsApi,
  createCheckPhotosApi,
  createCheckTemplatesApi,
  createPushApi,
  createReturnsApi,
  createScheduleSettingsApi,
  createEmployeesApi,
  createWarehouseAnalyticsApi,
  createClientSourcesApi,
  createJournalApi,
  createKnowledgeApi,
  createNotificationsApi,
} from '../../../shared/api/createServices';

export const authApi = createAuthApi(api);
export const usersApi = createUsersApi(api);
export const tenantsApi = createTenantsApi(api);
// Superadmin platform-operator endpoints not tied to a single tenant
// (audit log). Mirrors the createNotificationsApi factory wiring above.
export const adminApi = createAdminApi(api);
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
export const equipmentApi = createEquipmentApi(api);
export const warehousesApi = createWarehousesApi(api);
export const warrantyApi = createWarrantyApi(api);
export const stockMovementsApi = createStockMovementsApi(api);

export const checkPhotosApi = createCheckPhotosApi(api);
export const checkTemplatesApi = createCheckTemplatesApi(api);
export const pushApi = createPushApi(api);
export const returnsApi = createReturnsApi(api);
export const scheduleSettingsApi = createScheduleSettingsApi(api);
export const employeesApi = createEmployeesApi(api);
export const warehouseAnalyticsApi = createWarehouseAnalyticsApi(api);
export const clientSourcesApi = createClientSourcesApi(api);
export const journalApi = createJournalApi(api);
export const knowledgeApi = createKnowledgeApi(api);
export const notificationsApi = createNotificationsApi(api);

// Platform-specific upload for React Native
export const uploadsApi = {
  upload: async (uri: string, filename: string) => {
    const fd = new FormData();
    fd.append('file', {
      uri,
      name: filename || 'photo.jpg',
      type: 'image/jpeg',
    } as any);
    return api.post<{ url: string; thumbnail: string; filename: string; originalname: string; size: number }>(
      '/uploads',
      fd,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
  },
};
