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
  createBookingsApi,
  createPermissionTemplatesApi,
  createCashShiftsApi,
  createDebtsApi,
  createLoyaltyApi,
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
export const bookingsApi = createBookingsApi(api);
// Role templates — saved permission blueprints applied to employees. Gated
// director/admin/superadmin server-side; consumed by UsersScreen's permission
// matrix («Сохранить как роль» / «Применить роль»).
export const permissionTemplatesApi = createPermissionTemplatesApi(api);
// Кассовая смена / Z-отчёт / Инкассация — backend cash-shifts/ (migration 080).
// open/close/collect owner-gated server-side; current/report/list readable by
// any tenant user. Every response carries a recomputed Z-report.
export const cashShiftsApi = createCashShiftsApi(api);
// Дебиторка / долги клиентов — backend debts/ (migration 081). charge/payment/
// delete owner-class gated server-side; clientLedger/debtors readable by any
// tenant user. Every mutation returns the refreshed per-client summary so the
// UI updates instantly (DebtorsScreen + ClientDetailScreen debt section).
export const debtsApi = createDebtsApi(api);
// Программа лояльности / бонусы / кешбэк — backend loyalty/ (migration 083).
// settings PATCH + adjust owner-class gated server-side; accrue/redeem gated to
// cashier roles; reads open to any tenant user. Every mutation returns the
// refreshed per-client summary so the UI updates instantly (CompanySettings
// loyalty section + ClientDetailScreen bonus section).
export const loyaltyApi = createLoyaltyApi(api);

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
