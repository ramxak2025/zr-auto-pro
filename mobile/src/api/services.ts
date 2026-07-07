import api, { loginAcrossHosts } from './axios';
import {
  createAuthApi,
  createProfileApi,
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
  createMotivationApi,
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
  createRolesApi,
  createCashShiftsApi,
  createDebtsApi,
  createInstallmentsApi,
  createLoyaltyApi,
  createPurchaseOrdersApi,
  createPaymentsApi,
  createFiscalApi,
  createTelephonyApi,
  createWalletApi,
  createVoiceApi,
} from '../../../shared/api/createServices';

// Login uses happy-eyeballs across the failover ring (FIX B): fired at ALL ring
// hosts concurrently, first success wins — a slow/blocked primary no longer
// stalls sign-in ~15s before the reserve is tried. Login is the ONLY mutation
// safe to duplicate (password check + token issue, no side effects). Every OTHER
// auth method (register/me/logout/updateAvatar/deleteAccount) is passed through
// unchanged. On single-host builds `loginAcrossHosts` degrades to one ordinary
// request, so this wrapper is byte-for-byte the previous behaviour there.
const authApiBase = createAuthApi(api);
export const authApi: typeof authApiBase = {
  ...authApiBase,
  login: (data: Parameters<typeof authApiBase.login>[0]) =>
    loginAcrossHosts<Awaited<ReturnType<typeof authApiBase.login>>['data']>(data),
};
// «Мой профиль» (migration 099). Self profile edit + self password change for
// every role; владелец (director/superadmin) edits apply directly, сотрудник
// (admin/master) edits create a pending change-request that an owner approves.
// Consumed by ProfileScreen (entry: profile header on «Ещё»).
export const profileApi = createProfileApi(api);
export const usersApi = createUsersApi(api);
export const tenantsApi = createTenantsApi(api);
// Superadmin platform-operator endpoints not tied to a single tenant
// (audit log). Mirrors the createNotificationsApi factory wiring above.
export const adminApi = createAdminApi(api);
export const myCompanyApi = createMyCompanyApi(api);
export const plansApi = createPlansApi(api);
export const subscriptionApi = createSubscriptionApi(api);
// Голосовой ввод комментария (backend voice/, migration 115). transcribe шлёт
// multipart (raw LPCM 16k mono 16-bit + format=lpcm + sampleRateHertz=16000);
// usage — остаток помесячного пакета минут. Гейт кнопки — voice_input в тарифе
// (subscription.features) + VoiceUsage.configured. См. utils/voiceRecorder.ts.
export const voiceApi = createVoiceApi(api);
export const clientsApi = createClientsApi(api);
export const carsApi = createCarsApi(api);
export const productsApi = createProductsApi(api);
export const servicesApi = createServicesApi(api);
export const checksApi = createChecksApi(api);
export const suppliersApi = createSuppliersApi(api);
export const salaryApi = createSalaryApi(api);
// «Мотивация сотрудников» v1 — акционные товары (backend motivation/, миграция
// 095). getPromos/setPromo/clearPromo — owner-class (director/admin/superadmin)
// на сервере; getAccruals открыт любому сотруднику, но backend force-scope'ит
// непривилегированного к ЕГО собственным начислениям. Consumed by MotivationScreen
// (раздел «Ещё» → Финансы) + surfaced в SalaryScreen (MasterSalary.motivationAmount).
export const motivationApi = createMotivationApi(api);
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
// Роли (Bitrix24-style, миграция 114) — живая база прав: сервер строит
// эффективные права назначенного пользователя как «flatten(матрицы роли) ⊕
// персональные overrides». Все маршруты director/admin/superadmin-gated
// server-side; системные роли read-only (копия через create c copyFromRoleId).
// Consumed by RolesScreen / RoleEditorScreen + назначение роли в UsersScreen
// (само назначение — существующий usersApi.update(id, { roleId })).
export const rolesApi = createRolesApi(api);
// Кассовая смена / Z-отчёт / Инкассация — backend cash-shifts/ (migration 080).
// open/close/collect owner-gated server-side; current/report/list readable by
// any tenant user. Every response carries a recomputed Z-report.
export const cashShiftsApi = createCashShiftsApi(api);
// Дебиторка / долги клиентов — backend debts/ (migration 081). charge/payment/
// delete owner-class gated server-side; clientLedger/debtors readable by any
// tenant user. Every mutation returns the refreshed per-client summary so the
// UI updates instantly (DebtorsScreen + ClientDetailScreen debt section).
export const debtsApi = createDebtsApi(api);
// Рассрочка — backend installments/ (migration 093). REPLACES the manual
// «Дебиторка» as the primary sell-on-credit flow: a plan is created server-side
// when a check is sold with paymentMethod 'installment' (gated by the
// `sell_installment` permission). list/clientLedger are open to any tenant user;
// pay/payoff/reschedule, the dashboard widget and reminder settings are
// owner-class gated server-side (director/admin/superadmin). Consumed by
// InstallmentsScreen + InstallmentDetailScreen + the ClientDetail «Рассрочка»
// section + the Главная widget + InstallmentReminderSettingsScreen.
export const installmentsApi = createInstallmentsApi(api);
// Программа лояльности / бонусы / кешбэк — backend loyalty/ (migration 083).
// settings PATCH + adjust owner-class gated server-side; accrue/redeem gated to
// cashier roles; reads open to any tenant user. Every mutation returns the
// refreshed per-client summary so the UI updates instantly (CompanySettings
// loyalty section + ClientDetailScreen bonus section).
export const loyaltyApi = createLoyaltyApi(api);
// Заказы поставщикам + приёмка — backend purchase-orders/. list/getById/
// suggestions readable by any tenant user; create/update/order/receive/cancel
// owner-class gated server-side (director/admin/superadmin). receive credits
// product stock (income path) — clients invalidate ['products']/['stock-movements']
// after a receive. Consumed by PurchaseOrders / PurchaseOrderCreate /
// PurchaseOrderDetail screens (entry: «Заказы поставщикам» в разделе Склад).
export const purchaseOrdersApi = createPurchaseOrdersApi(api);
// Эквайринг (приём оплаты картой / СБП) — backend payments/ (ЮKassa / Тинькофф).
// getSettings/updateSettings owner-class gated server-side (director/admin/
// superadmin); the secret key is WRITE-ONLY — getSettings returns only a mask +
// hasSecretKey. INERT until the owner enters real shopId + secretKey AND flips
// enabled on (POST /payments/create returns 422 before that). Consumed by the
// PaymentIntegrations settings screen (раздел «Ещё» → «Приём оплат и касса»).
export const paymentsApi = createPaymentsApi(api);
// Онлайн-касса / фискализация 54-ФЗ (АТОЛ) — backend fiscal/. getSettings/
// updateSettings owner-class gated server-side; the АТОЛ password is WRITE-ONLY —
// getSettings returns only a mask + hasPassword. INERT until login + password +
// groupCode are entered AND enabled is on. Consumed by the same
// PaymentIntegrations settings screen (section «Онлайн-касса 54-ФЗ»).
export const fiscalApi = createFiscalApi(api);
// Телефония / виртуальная АТС (Mango Office) — backend telephony/ (migration 088).
// getSettings/updateSettings owner-class gated server-side; the Mango vpbx api_key
// и api_salt — WRITE-ONLY: getSettings возвращает только маски + hasApiKey/hasApiSalt,
// никогда сырые секреты. INERT, пока владелец не введёт ключ+соль И не включит
// enabled. Входящие/пропущенные звонки Mango пушит на публичный server-only
// webhook → они персистятся в таблицу calls и появляются в обычном списке звонков
// (CallsScreen). Consumed by IntegrationsScreen → секция «Телефония и звонки».
export const telephonyApi = createTelephonyApi(api);
// Apple Wallet — карта лояльности (.pkpass) — backend wallet/ (migration 089).
// getSettings/updateSettings owner-class gated server-side; сертификат Pass Type ID,
// приватный ключ, пароль ключа и WWDR — WRITE-ONLY: getSettings возвращает только
// булевы флаги hasCert/hasCertKey/hasWwdr (+ configured), никогда сырой PEM. INERT,
// пока владелец не загрузит реальный сертификат + ключ + WWDR И не включит enabled —
// getPass(clientId) до этого возвращает 422. getPass отдаёт подписанный .pkpass
// blob'ом (application/vnd.apple.pkpass): экран отдаёт байты в Apple Wallet. Кнопка
// «Добавить в Apple Wallet» на карточке клиента / в разделе лояльности.
export const walletApi = createWalletApi(api);

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
