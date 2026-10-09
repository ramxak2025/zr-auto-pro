// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Request/Response types
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  User,
  ProfileChangeRequest,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeBlock,
  KnowledgeQuizQuestion,
  TroubleshootingSeverity,
  BroadcastButton,
  BroadcastSegment,
  NotificationCategory,
  SubscriptionStatus,
  LateStatus,
  WorkModeDayTimes,
  PublicBookingHours,
  PublicBookingMode,
  PublicBookingOperator,
} from '../types';

// ─── Notifications ─────────────────────────────────────────────────────────────

/** PUT /notifications/preferences body — full set of MUTED categories. */
export interface UpdateNotificationPreferencesRequest {
  muted: NotificationCategory[];
}

/** POST /admin/broadcast body — superadmin only. */
export interface CreateBroadcastRequest {
  title: string;
  body: string;
  imageUrl?: string;
  buttons?: BroadcastButton[];
  /** 096 — ISO 8601 instant to defer delivery to; omit / past = send immediately. */
  scheduledAt?: string;
  /** 096 — recipient segment; omit / empty = all active tenants. */
  segment?: BroadcastSegment;
}

export interface LoginRequest {
  phone: string;
  password: string;
}

/**
 * Успешный вход: токен сессии + профиль. `user.currentPointId` — филиал ЭТОЙ
 * сессии (163), а не «последний выбранный на любом устройстве».
 */
export interface LoginResponse {
  token: string;
  user: User;
}

/**
 * ВХОД С ВЫБОРОМ ФИЛИАЛА (163) — шаг 1. Отдельный тип запроса, а не
 * необязательное поле в {@link LoginRequest}, ровно по одной причине: признак
 * поддержки и тип ответа обязаны меняться ВМЕСТЕ. Прислав `supportsPointSelect`
 * в обычный login(), клиент получил бы ответ без `token`, который его код
 * прочитать не умеет, — пустой экран у живого автосервиса.
 *
 * Клиенты 3.5/3.6 этого признака не шлют и продолжают получать токен сразу:
 * филиал за них выбирает сервер (последний использованный, иначе основной).
 */
export type PointSelectLoginRequest = LoginRequest & { supportsPointSelect: true };

/** Филиал в списке выбора при входе. */
export interface LoginPointOption {
  id: string;
  name: string;
  address: string | null;
  /** Основной сервис тенанта (сам автосервис), а не открытый позже филиал. */
  isMain: boolean;
}

/**
 * Ответ шага 1, когда сотруднику доступно НЕСКОЛЬКО филиалов. Полноценного
 * токена здесь НЕТ и быть не может: сессия обязана принадлежать конкретному
 * филиалу.
 *
 * Клиент показывает `points`, подсвечивает `defaultPointId` (где человек
 * работал в прошлый раз) и вторым шагом вызывает POST /auth/select-point.
 */
export interface PointSelectionRequiredResponse {
  /** Дискриминатор: в этом ответе НЕТ `token`. */
  pointSelectionRequired: true;
  /**
   * Промежуточный токен. Живёт минуты, ОДНОРАЗОВЫЙ (после обмена мёртв) и не
   * принимается ни одной обычной ручкой API — только POST /auth/select-point.
   * Хранить его дольше экрана выбора не нужно.
   */
  selectToken: string;
  /** Сколько секунд живёт selectToken (сейчас 300). */
  expiresIn: number;
  /** Доступные сотруднику живые филиалы; основной сервис первым. */
  points: LoginPointOption[];
  /** Филиал по умолчанию для подсветки: последний использованный, иначе основной. */
  defaultPointId: string;
}

/**
 * Ответ шага 1 для клиента, умеющего выбирать филиал. Различать варианты —
 * по `pointSelectionRequired`:
 *
 *   const res = await authApi.loginWithPointSelect({ phone, password });
 *   if ('pointSelectionRequired' in res.data) { …экран выбора… }
 *   else { …обычный вход, res.data.token… }
 */
export type PointSelectLoginResponse = LoginResponse | PointSelectionRequiredResponse;

/**
 * POST /auth/select-point — шаг 2 входа. Пароль здесь НЕ участвует: он
 * проверен на шаге 1. Ответ — обычный {@link LoginResponse}.
 */
export interface SelectPointRequest {
  selectToken: string;
  pointId: string;
}

/**
 * МГНОВЕННАЯ СМЕНА ФИЛИАЛА (167) — тело POST /auth/switch-point.
 *
 * Доступна ТОЛЬКО держателю права управления персоналом (владелец, директор,
 * админ сети) и только из раздела «Филиалы». Остальным сервер отвечает 403 с
 * объяснением, что филиал меняется выходом и повторным входом, — прежний
 * сценарий 163 для сотрудника сохраняется дословно.
 *
 * Режима «все филиалы» нет: `pointId` обязателен и обязан быть филиалом, к
 * которому у актора уже есть доступ.
 */
export interface SwitchSessionPointRequest {
  pointId: string;
}

/**
 * Ответ POST /auth/switch-point. Это ПЕРЕВЫПУСК сессии: сервер выдаёт новый
 * токен с новым филиалом и НЕМЕДЛЕННО гасит старый.
 *
 * ЧТО КЛИЕНТ ОБЯЗАН СДЕЛАТЬ С ОТВЕТОМ: применить `token` атомарно (как после
 * входа) и только потом обновлять данные — прежний bearer мёртв, любой запрос
 * с ним получит 401. `user` отдаётся тем же ответом, чтобы не звать /auth/me.
 *
 * `switched: false` — актор УЖЕ работал в этом филиале: ничего не
 * перевыпускалось, а `token` содержит тот же токен, что и был. Поэтому
 * безусловный commit ответа безопасен в обеих ветках.
 */
export interface SwitchSessionPointResponse {
  /** Токен сессии ПОСЛЕ вызова: новый при `switched: true`, прежний при `false`. */
  token: string;
  /** Профиль актора; `user.currentPointId` — филиал ЭТОЙ сессии после вызова. */
  user: User;
  /** Филиал сессии после вызова (равен запрошенному при успехе). */
  currentPointId: string | null;
  /** true — токен перевыпущен и старый мёртв; false — актор уже был в этом филиале. */
  switched: boolean;
}

export interface RegisterRequest {
  phone: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

// ─── Self-service registration requests (migration 123) ────────────────────────

/**
 * PUBLIC body of POST /registration-requests — a prospective owner's self-service
 * registration request from the login screen (UNAUTHENTICATED). The owner chooses
 * their own password (min 8 chars); it is bcrypt-hashed server-side and reused to
 * create the owner account on approval. The endpoint returns only `{ ok: true }`.
 */
export interface RegisterRequestPayload {
  companyName: string;
  ownerName: string;
  phone: string;
  password: string;
  comment?: string;
}

/**
 * POST /admin/registration-requests/:id/approve (superadmin) — create the tenant +
 * owner + a FREE trial. Default trial is 14 days if neither field is given; `until`
 * (an explicit future ISO date) wins over `trialDays`.
 */
export interface ApproveRegistrationRequest {
  until?: string;
  trialDays?: number;
}

/** POST /admin/registration-requests/:id/reject (superadmin). */
export interface RejectRegistrationRequest {
  reason?: string;
}

// ─── Account deletion (Apple 5.1.1(v) / Google Play data-deletion) ──────────────

/** POST /account/delete body — re-confirmation required to avoid accidents. */
export interface DeleteAccountRequest {
  /** The caller's CURRENT password — re-authentication. */
  password: string;
  /** Explicit confirmation from the destructive dialog (must be true). */
  confirm: boolean;
}

/**
 * Outcome of a deletion request.
 *   - 'account_deleted'            — a non-owner employee's own record was
 *                                    anonymized + retired immediately.
 *   - 'tenant_deletion_requested' — the account holder (director) closed the
 *                                    whole tenant: access revoked now, physical
 *                                    purge after the grace window.
 */
export type AccountDeletionStatus = 'account_deleted' | 'tenant_deletion_requested';

export interface DeleteAccountResponse {
  status: AccountDeletionStatus;
  message: string;
  /** ISO instant the tenant deletion was requested (tenant branch only). */
  deletionRequestedAt?: string;
  /** ISO instant the residual data is physically purged (tenant branch only). */
  purgeScheduledAt?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface ShiftsQuery extends PaginationParams {
  /** Business day (YYYY-MM-DD): all shifts for this day in the session point. */
  date?: string;
}

/**
 * 161 — параметры списка сотрудников. `scope: 'point'` ЯВНО просит только тех,
 * кто назначен на текущий филиал (user_points; сотрудник без назначений виден
 * везде — безопасный дефолт 156).
 *
 * БЕЗ параметра список прежний, на весь тенант, и это НЕ забывчивость: тем же
 * списком резолвятся имена в журнале, расходах и зарплате (автор чека с
 * другого филиала иначе превратился бы в «—») и им же владелец назначает людей
 * на точки. Скоуп просит ровно тот экран, где чужой сотрудник означает
 * неверные деньги, — пикер мастера в Кассе.
 */
export interface UsersQuery extends PaginationParams {
  scope?: 'point';
}

export interface CarsQuery extends PaginationParams {
  /**
   * «Без номеров» filter. When true, the server returns only cars registered
   * without a plate (no_plate flag set, or an empty stored plate). Applied
   * server-side so it spans the whole paginated dataset, not just one page.
   */
  noPlate?: boolean;
}

/**
 * Параметры `GET /products` (`productsApi.getAll`): пагинация/поиск + склад и
 * адрес хранения (172, 2026-09-30, ячейки).
 *
 * `search` теперь ДОПОЛНИТЕЛЬНО матчит код ячейки (`A-01-03`), а не только
 * название и штрихкод — поиск по адресу не требует отдельного параметра.
 */
export interface ProductsQuery extends PaginationParams {
  /**
   * id склада; `'all'` — все склады филиала сессии; без параметра — ОСНОВНОЙ склад
   * филиала сессии (прежнее поведение, старые клиенты не меняются).
   */
  warehouseId?: string;
  /**
   * 172 — фильтр «содержимое ячейки»: uuid ячейки (`StorageCell.id`) или
   * `'none'` — товары без адреса. Без параметра фильтра по ячейке нет. Сочетается
   * с `warehouseId` (ячейка всё равно принадлежит одному складу).
   */
  storageCellId?: string;
}

export interface ChecksParams extends PaginationParams {
  masterId?: string;
  clientId?: string;
  carId?: string;
  dateFrom?: string;
  dateTo?: string;
  retail?: string;
  /**
   * OPTIONAL keyset cursor (opaque, from a previous response's `nextCursor`).
   * Presence switches the journal to keyset pagination — the offset
   * `{ page, limit }` path is untouched when this is omitted. Pass an empty
   * string to fetch the first keyset page (newest checks).
   */
  cursor?: string;
}

export interface DateRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

export interface CashFlowParams extends DateRangeParams {
  masterId?: string;
}

export interface CreateUserRequest {
  phone: string;
  password: string;
  fullName: string;
  role: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
  /**
   * Target tenant for the new user — ONLY honoured when the caller is a
   * superadmin creating an employee inside a tenant from the admin cabinet.
   * For any non-superadmin caller the server ignores this and uses the
   * caller's own tenant (a director cannot create users in other tenants).
   */
  tenantId?: string;
  /** Tenant-owned staff grouping. Only owner-class actors may assign it. */
  directionId?: string | null;
}

export interface UpdateUserRequest {
  phone?: string;
  password?: string;
  fullName?: string;
  role?: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
  daysOff?: number[];
  isActive?: boolean;
  team?: string | null;
  /** 047_expenses_by_employee — gate for non-privileged users to /expenses POST. */
  canAddExpenses?: boolean;
  /** Daily cap (RUB). Null/undefined → unlimited. */
  dailyExpenseLimit?: number | null;
  /** 055 — hide from Schedule grid + attendance Rating. */
  hiddenFromSchedule?: boolean;
  /** 055 — hide everywhere (lists + cannot be chosen as master on a new check). */
  hiddenEverywhere?: boolean;
  /**
   * 114 — назначенная роль (Bitrix24-style): uuid системной роли или роли
   * своего тенанта; null снимает роль (возврат к легаси-дефолтам строковой
   * роли). Сервер валидирует видимость роли и самолокаут (нельзя эффективно
   * снять с себя user_management).
   */
  roleId?: string | null;
  /** Tenant-owned staff grouping. null clears it; only owner-class may change it. */
  directionId?: string | null;
}

export interface CreateClientRequest {
  fullName: string;
  phone: string;
  comment?: string;
  /** Acquisition source tag — 046_clients_source. Empty string → null. */
  source?: string | null;
  /** Owner-only free-form notes. Capped at 4000 chars server-side. */
  ownerNotes?: string | null;
}

export interface UpdateClientRequest {
  fullName?: string;
  phone?: string;
  comment?: string;
  source?: string | null;
  ownerNotes?: string | null;
}

export interface CreateCarRequest {
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
  /** 059 — register the car "без номера"; plate is stored empty. */
  noPlate?: boolean;
  /**
   * 171 — VIN (17 символов, нормализуется сервером через normalizeVin). Принимается
   * только при включённой опции Tenant.vinEnabled; дубликат VIN внутри тенанта →
   * 409 {code:'VIN_DUPLICATE', carId, clientId, clientName}.
   */
  vin?: string | null;
}

export interface UpdateCarRequest {
  plateNumber?: string;
  makeModel?: string;
  comment?: string;
  clientId?: string;
  /** 059 — toggle "без номера". When true, the stored plate is cleared. */
  noPlate?: boolean;
  /** 171 — VIN; null/'' — очистить. См. CreateCarRequest.vin. */
  vin?: string | null;
}

/**
 * Body for POST /cars/:id/transfer-owner («сменить владельца»). Reassigns the car
 * to `clientId`. `moveHistory` (default true) also carries the car's check history
 * — and the debt / installment / loyalty rows derived from those checks — to the
 * new owner. Gated by 'clients_edit'; owner-class bypasses.
 */
export interface TransferCarOwnerRequest {
  /** New owner (client) id — must exist in the tenant. */
  clientId: string;
  /** Carry the car's check history to the new owner. Defaults to true. */
  moveHistory?: boolean;
}

export interface CreateProductRequest {
  name: string;
  category?: string;
  /** Photo URL. Send `null` or `''` to store no photo. */
  photo?: string | null;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  /** EAN-13 / QR / произвольный код. Omit or send undefined to store none. */
  barcode?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
  supplierId?: string;
  warehouseId?: string;
  warrantyDays?: number | null;
  /**
   * 172 (2026-09-30) — адрес хранения: id ячейки склада, куда кладётся товар.
   * Ячейка обязана принадлежать тенанту и ТОМУ ЖЕ складу, что и товар (`warehouseId`
   * из этого же запроса или основной склад филиала), иначе
   * `400 { code: 'STORAGE_CELL_WRONG_WAREHOUSE' }`. Omit / `null` — без адреса.
   */
  storageCellId?: string | null;
}

export interface UpdateProductRequest {
  name?: string;
  category?: string;
  /**
   * Photo URL. To REMOVE an existing photo send `null` or `''` — the server
   * replaces the stored value exactly (clears it to NULL), it does not merge
   * with the previous photo. Omitting the field leaves the photo unchanged (#63).
   */
  photo?: string | null;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  minStock?: number;
  unit?: string;
  /**
   * EAN-13 / QR / произвольный код. Send `''` to CLEAR the stored barcode;
   * omitting the field leaves it unchanged (backend PATCH sets only when
   * the field is present).
   */
  barcode?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
  supplierId?: string;
  warehouseId?: string;
  warrantyDays?: number | null;
  /**
   * 172 (2026-09-30) — адрес хранения. UUID ячейки — положить товар в неё
   * (ячейка обязана быть на том же складе, что и товар — с учётом `warehouseId` из
   * этого же запроса; иначе `400 { code: 'STORAGE_CELL_WRONG_WAREHOUSE' }`);
   * `null` — СНЯТЬ адрес; поле не передано — адрес не меняется. Если в запросе
   * меняется `warehouseId`, а `storageCellId` не передан, сервер сбрасывает адрес
   * в null (ячейка старого склада новому не принадлежит).
   */
  storageCellId?: string | null;
}

export interface StockUpdateRequest {
  type: 'income' | 'expense' | 'writeoff' | 'inventory';
  quantity: number;
  reason?: string;
  /** Only respected when type === 'writeoff'. Also writes an expenses row. */
  recordAsExpense?: boolean;
}

/**
 * Rounding rule for a bulk sell-price adjustment. Applied AFTER the percent
 * change to make prices "nice".
 *   • 'none' → plain round to 2 decimals.
 *   • 'up'   → ceil to `step`  (156, step 50 → 200).
 *   • 'down' → floor to `step` (156, step 50 → 150).
 * `step` must be > 0 (ignored when mode='none').
 */
export interface BulkAdjustPriceRounding {
  mode: 'none' | 'up' | 'down';
  step: number;
}

/**
 * Body for POST /products/bulk-adjust-price (owner-class only). Raises / lowers
 * the SELL price of a chosen scope by a percent. Only ever changes sell_price;
 * cost_price / stock are untouched. `dryRun: true` previews «было → стало»
 * WITHOUT writing.
 */
export interface BulkAdjustPriceRequest {
  /** 'all' | 'categories' (folders incl. descendants) | 'products'. */
  scope: 'all' | 'categories' | 'products';
  /** warehouse_categories ids — required (non-empty) when scope='categories'. */
  categoryIds?: string[];
  /** product ids — required (non-empty) when scope='products'. */
  productIds?: string[];
  /** Raise or lower. */
  direction: 'increase' | 'decrease';
  /** Percent to change by (>0, ≤1000). 10 = ±10%. */
  percent: number;
  /** Optional rounding rule applied after the percent change. */
  rounding?: BulkAdjustPriceRounding;
  /** true → preview only (no write). false / omitted → apply. */
  dryRun?: boolean;
}

/** One «было → стало» preview row (dry-run only), capped at 30 rows. */
export interface BulkAdjustPriceExample {
  id: string;
  name: string;
  oldPrice: number;
  newPrice: number;
}

/**
 * Response of POST /products/bulk-adjust-price.
 *   • dryRun=true  → { affected, examples }  (nothing written).
 *   • apply        → { affected }            (examples undefined).
 */
export interface BulkAdjustPriceResponse {
  /** How many products match / were updated. */
  affected: number;
  /** Present only on a dry-run — up to 30 «было → стало» rows. */
  examples?: BulkAdjustPriceExample[];
}

/**
 * Body for POST /products/bulk-delete — mass SOFT-delete (move to Корзина).
 * Never hard-deletes. All three inputs are additive; any combination may be sent.
 *   • productIds  → trash these products (≤2000).
 *   • categoryIds → trash these folders + their contents/subfolders (cascade).
 *   • deleteAll   → trash every live product, scoped to `warehouseId` when set
 *     (UI passes the current warehouse so Б/У + брак are untouched).
 */
export interface BulkDeleteRequest {
  productIds?: string[];
  categoryIds?: string[];
  deleteAll?: boolean;
  warehouseId?: string;
}

/** Response of POST /products/bulk-delete — counts of rows moved to trash. */
export interface BulkDeleteResponse {
  deletedProducts: number;
  deletedCategories: number;
}

/**
 * Body for POST /products/bulk-move — массовый перенос товаров в другую папку
 * (категорию). Транзакционно: либо переносятся ВСЕ, либо ничего (в отличие от
 * клиентского цикла PATCH-ей). Скоуп — текущий склад (`warehouseId`; absent →
 * основной), чтобы одноимённые пути в Б/У/браке не задевались.
 *   • productIds     → какие товары переносим (≤2000).
 *   • targetCategory → path целевой папки («Масла/Синтетика»); '' = в корень
 *     (category=NULL). Несуществующая папка создаётся идемпотентно.
 */
export interface BulkMoveRequest {
  productIds: string[];
  targetCategory: string;
  warehouseId?: string;
}

/** Response of POST /products/bulk-move. */
export interface BulkMoveResponse {
  movedProducts: number;
}

/**
 * 172 (2026-09-30) — body of POST /products/bulk-assign-cell: массово положить
 * товары в одну ячейку (или снять адрес). Транзакционно: либо все, либо ничего.
 * Гейт `warehouse_manage`.
 *   • productIds     → какие товары (≤ 2000); ВСЕ обязаны лежать на складе
 *     ячейки — иначе 400 `STORAGE_CELL_WRONG_WAREHOUSE` со списком чужих id.
 *   • storageCellId  → uuid ячейки, либо `null` — снять адрес у всех перечисленных.
 */
export interface BulkAssignCellRequest {
  productIds: string[];
  storageCellId: string | null;
}

/** Response of POST /products/bulk-assign-cell. */
export interface BulkAssignCellResponse {
  /** Сколько товаров изменено (у которых адрес реально сменился). */
  updated: number;
}

// ─── Ячейки хранения (172, 2026-09-30) — /storage-cells ─────────────────────────
// Возвращаемая сущность — `StorageCell` из ../types. Чтение — право
// `warehouse_access`, изменение — `warehouse_manage`. Филиал ячейки определяет её
// склад (ячейка чужого филиала недоступна, как и товар).

/** POST /storage-cells — завести одну ячейку на складе. Дубль кода → 409 `STORAGE_CELL_EXISTS`. */
export interface CreateStorageCellRequest {
  warehouseId: string;
  /** Сервер нормализует (`normalizeCellCode`): trim, схлопнуть пробелы, верхний регистр. */
  code: string;
  /** Необязательная подпись («у входа», «масла»). */
  name?: string;
}

/**
 * POST /storage-cells/bulk — массовое создание (сетка «стеллаж × полка × ячейка»):
 * коды генерирует КЛИЕНТ (`generateCellCodes` из `shared/utils/storageCells`), сервер
 * принимает готовый список.
 */
export interface BulkCreateStorageCellsRequest {
  warehouseId: string;
  /** ≤ 2000 (`MAX_BULK_CELLS`); больше — 400. Сервер нормализует каждый код и убирает дубли внутри списка. */
  codes: string[];
}

/** Response of POST /storage-cells/bulk. */
export interface BulkCreateStorageCellsResponse {
  /** Сколько ячеек создано. */
  created: number;
  /** Нормализованные коды, которые на складе уже были, — пропущены, это НЕ ошибка. */
  skipped: string[];
}

/** PATCH /storage-cells/:id — переименовать / подписать / переставить. Дубль кода → 409 `STORAGE_CELL_EXISTS`. */
export interface UpdateStorageCellRequest {
  code?: string;
  /** Пустая строка или `null` снимают подпись; поле не передано — подпись не меняется. */
  name?: string | null;
  sortOrder?: number;
}

/**
 * Query of DELETE /storage-cells/:id. Пустую ячейку удаляют без параметров. Если в ней
 * лежат товары, нужен ровно один из двух: `moveTo` (перенести товары в другую ячейку
 * ТОГО ЖЕ склада) или `detach: true` (снять с товаров адрес). Иначе —
 * 409 `STORAGE_CELL_NOT_EMPTY { productsCount }`.
 */
export interface RemoveStorageCellParams {
  moveTo?: string;
  detach?: boolean;
}

export interface CreateServiceRequest {
  priceType?: 'fixed' | 'range';
  minPrice?: number;
  maxPrice?: number;
  name: string;
  category?: string;
  defaultPrice: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export interface UpdateServiceRequest {
  priceType?: 'fixed' | 'range';
  minPrice?: number;
  maxPrice?: number;
  name?: string;
  category?: string;
  defaultPrice?: number;
  masterPercent?: number | null;
  warrantyDays?: number | null;
}

export type PutServiceVisibilityRuleRequest =
  | { serviceId: string; visibleRoleIds: string[] }
  | { categoryPath: string; visibleRoleIds: string[] };

export interface CreateCheckRequest {
  /**
   * Идемпотентность (офлайн-очередь): UUID, сгенерированный клиентом один раз
   * на логический чек и повторяемый с каждым ретраем. Сервер гарантирует
   * максимум один чек на (tenant, clientRequestId): повторный POST возвращает
   * УЖЕ созданный чек (тот же id/number) без повторного списания стока /
   * зарплаты / выручки. Опционально — без него поведение прежнее.
   */
  clientRequestId?: string;
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
    id?: string;
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    /**
     * С 2026-09-30 у услуг в Кассе нет количества: строка = одна услуга по
     * одной цене, клиенты поле НЕ шлют (сервер считает `quantity || 1`, старые
     * версии приложений продолжают слать его, и их суммы не ломаются). Передавать
     * стоит только `quantity` legacy-строки при правке СТАРОГО чека (он > 1),
     * без изменений. У товаров (`products[].quantity`) количество остаётся.
     */
    quantity?: number;
  }>;
  products: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
  /**
   * Метки чека (Round 12 #9): id из справочника меток тенанта. Присутствие
   * поля = «привязать ровно этот набор»; отсутствие = без меток (сервер
   * связок не создаёт). Чужие/архивные id сервер молча отбрасывает.
   */
  tagIds?: string[];
  /**
   * Место заказа (Round 14, tenant_locations): id из справочника мест.
   * ''/null/absent → без места. Чужой/несуществующий id → 400 «Место не
   * найдено».
   */
  locationId?: string | null;
  /**
   * Исполнители заказа (Round 14, check_assignees): id сотрудников тенанта.
   * Absent → сервер выводит дефолт (distinct исполнители строк услуг +
   * главный мастер), поэтому доски работают и для старых клиентов. Чужие/
   * кривые id сервер молча отбрасывает. Зарплату не двигает.
   */
  assigneeIds?: string[];
  /**
   * Филиал заказа (мульти-точки 156/160) — ТОЛЬКО для офлайн-очереди.
   *
   * Обычный онлайн-сабмит поле НЕ шлёт: сервер штампует текущую точку автора,
   * и это правильный ответ, потому что момент запроса = момент «Пробить».
   * Офлайн-очередь может пролежать до возврата сети: мастер набил чек на
   * филиале А, доехал до Б, переключил точку — и досылка записала бы выручку
   * филиалу Б. Поэтому очередь кладёт сюда точку в момент нажатия «Пробить».
   *
   * Сервер ПРОВЕРЯЕТ доступ автора к присланной точке и молча игнорирует
   * значение, если проверку оно не прошло (берёт текущую): досылка не должна
   * ни падать 400-й, ни переносить деньги в чужой филиал.
   */
  pointId?: string;
}

export interface UpdateCheckRequest {
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
    id?: string;
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    /** См. `CreateCheckRequest.services[].quantity`: новые строки его не шлют (= 1); legacy-строка старого чека — как есть. */
    quantity?: number;
  }>;
  products?: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
  /**
   * Метки чека (Round 12 #9): присутствие поля = «перезаписать связки ровно
   * этим набором» (пустой массив снимает все метки); отсутствие = «не
   * трогать» — частичный PATCH и старые клиенты метки не стирают.
   */
  tagIds?: string[];
  /**
   * Место заказа (Round 14): присутствие поля = установить (''/null снимает
   * место); отсутствие = «не трогать». Чужой id → 400.
   */
  locationId?: string | null;
  /**
   * Исполнители (Round 14): присутствие поля = «перезаписать набор ровно
   * этими сотрудниками» (пустой массив снимает всех); отсутствие = «не
   * трогать» — частичный PATCH и старые клиенты набор не стирают.
   */
  assigneeIds?: string[];
}

/**
 * Строка услуги в теле `POST/PUT /check-templates` (2026-09-30, «услуги без
 * количества»). Новые клиенты `quantity` НЕ шлют: сервер принимает поле, если оно
 * пришло, но сохраняет 1. Старые версии приложений продолжают слать число, и их
 * запросы остаются валидными. Ответ сервера (`CheckTemplate.services[].quantity`)
 * по-прежнему число: у новых шаблонов 1, у старых бывает больше 1 — такие строки
 * клиент разворачивает через `expandServiceQuantities` (`shared/utils/checkLines`).
 */
export interface CheckTemplateServiceInput {
  serviceId?: string;
  name: string;
  price: number;
  quantity?: number;
}

export interface CreateSupplierRequest {
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface UpdateSupplierRequest {
  name?: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface CreateDeliveryRequest {
  supplierId: string;
  requestId?: string;
  date?: string;
  comment?: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
    /** Omitted preserves current retail; zero is valid. */
    sellPrice?: number;
  }>;
}

export interface CreatePaymentRequest {
  supplierId: string;
  amount: number;
  date?: string;
  comment?: string;
  /** 149 — «за какой месяц» платёж ('YYYY-MM'); absent = месяц даты факта. */
  periodMonth?: string;
}

/**
 * «Возврат от поставщика» (Round 14). `amount` — ПОЛОЖИТЕЛЬНАЯ сумма возврата;
 * сервер сам сохраняет строку kind='refund' с отрицательным amount и двигает
 * баланс (total_paid -= amount, current_debt += amount). Гейт —
 * suppliers_payments_correct.
 */
export interface SupplierRefundRequest {
  supplierId: string;
  amount: number;
  date?: string;
  comment?: string;
  /** 149 — «за какой месяц» возврат ('YYYY-MM'); симметрично платежу. */
  periodMonth?: string;
}

export interface CreateScheduleRequest {
  userId: string;
  date: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  isDayOff?: boolean;
  note?: string | null;
  lateStatus?: LateStatus | null;
  lateMinutes?: number;
  actualArrival?: string | null;
}

export interface UpdateScheduleRequest extends Omit<CreateScheduleRequest, 'userId' | 'date'> {}

export interface CreateWorkModeRequest {
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays?: number[];
  shiftStart: string;
  shiftEnd: string;
  dayTimes?: WorkModeDayTimes;
}

export interface UpdateWorkModeRequest {
  name?: string;
  type?: 'rotating' | 'weekly';
  workDays?: number;
  offDays?: number;
  weekDays?: number[];
  shiftStart?: string;
  shiftEnd?: string;
  /** Omitted preserves overrides; an empty object clears them. */
  dayTimes?: WorkModeDayTimes;
}

export interface CreateTenantRequest {
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
  /**
   * 173 (2026-09-30) — сразу закрепить создаваемый автосервис за менеджером
   * платформы (id пользователя с ролью `manager`, активного). Только суперадмин
   * (`POST /tenants`); null / не передан — клиент владельца, «без менеджера».
   * Менеджер сам создаёт автосервисы через `POST /manager/tenants`
   * ({@link CreateManagerTenantRequest}), там менеджер = он сам.
   */
  managerId?: string | null;
}

export interface UpdateTenantRequest {
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
  /** 070 — flip the «Смены» (shifts) subsystem on/off for the tenant. */
  shiftsEnabled?: boolean;
  attendanceMode?: 'admin' | 'manual' | 'nfc';
  /** 092 — flip POS «Кассовая смена + роли» mode on/off for the tenant. */
  shiftModeEnabled?: boolean;
  /** 115 — индивидуальная надбавка минут голосового ввода поверх тарифа (суперадмин). */
  voiceMinutesExtra?: number;
}

/**
 * POST /tenants/:id/extend — extend the tenant's subscription, PAID or FREE.
 *
 * BACKWARD-COMPAT: the legacy `{ days }` body still works exactly as before —
 * `days` is now optional and, with no `type`/`amount`, records a FREE ledger
 * entry (no revenue). To record PAID revenue the caller MUST send
 * `type: 'paid'` + `amount > 0`. `until` (an explicit future date) wins over
 * `days` when both are present.
 */
export interface ExtendSubscriptionRequest {
  /** Legacy path — extend by N days, anchored on max(current end, now). */
  days?: number;
  /**
   * 122 — 'paid' records collected revenue (requires `amount` > 0); 'free'
   * records a zero-revenue extension. Omitted → treated as FREE (no amount ⇒
   * no revenue).
   */
  type?: 'paid' | 'free';
  /** 122 — payment amount in rubles (required and > 0 when type='paid'; 0/ignored for free). */
  amount?: number;
  /** 122 — set the new subscription_end to this ISO date (must be in the future). Wins over `days`. */
  until?: string;
  /** 122 — optional human note stored on the ledger row. */
  note?: string;
  /**
   * 173 (2026-09-30) — ТОЛЬКО для суперадмина (`POST /tenants/:id/extend`) и
   * только при `type: 'paid'`: «Оплату получил менеджер <Имя> — учесть его долю».
   * Если у тенанта есть менеджер (`Tenant.managerId`) и флаг true, в платёж
   * пишется снимок доли (`managerId`, `ownerSharePercent`, `ownerShareAmount`) —
   * как при оплате, проведённой самим менеджером. Без флага (по умолчанию) деньги
   * считаются полученными владельцем напрямую и доля НЕ начисляется. Бесплатные
   * продления долю не создают никогда. Менеджерский `POST /manager/tenants/:id/extend`
   * флаг игнорирует: его платные продления всегда несут долю.
   */
  creditManager?: boolean;
}

/** POST /tenants/:id/assign-plan — switch the tenant to a plan (syncs price + max users). */
export interface AssignPlanRequest {
  planId: string;
}

/** POST /tenants/:id/suspend — explicitly suspend a tenant (superadmin). */
export interface SuspendTenantRequest {
  /** Optional human note stored on the tenant + surfaced in the cabinet status. */
  reason?: string;
}

// ─── Менеджеры платформы (173, 2026-09-30) ─────────────────────────────────────
// Возвращаемые сущности — `PlatformManager`, `PlatformManagerDetail`, `ManagerSummary`,
// `ManagerSettlement`, `ManagerLedger` из ../types. Маршруты суперадмина —
// `/admin/managers*` (adminManagersApi), маршруты самого менеджера — `/manager/*`
// (managerApi).

/** POST /admin/managers — завести менеджера (только суперадмин). Телефон занят → 409 `PHONE_TAKEN`. */
export interface CreateManagerRequest {
  fullName: string;
  /** Логин менеджера; уникален глобально, среди всех пользователей платформы. */
  phone: string;
  /** ≥ 6 символов. */
  password: string;
  /** Доля владельца, % (0–100). Не передан — 60. */
  ownerSharePercent?: number;
  /** Заметка суперадмина (хранится в `users.owner_notes`). */
  note?: string;
}

/**
 * PATCH /admin/managers/:id — правка менеджера (только суперадмин). Передаются только
 * изменяемые поля. Смена `ownerSharePercent` действует на БУДУЩИЕ платежи: у уже
 * проведённых платежей доля — снимок, он не пересчитывается.
 */
export interface UpdateManagerRequest {
  fullName?: string;
  phone?: string;
  /** Новый пароль (≥ 6 символов); в аудит не пишется. */
  password?: string;
  ownerSharePercent?: number;
  /** false — менеджер не может войти; его клиенты остаются за ним. */
  isActive?: boolean;
  /** Заметка суперадмина; `null` или пустая строка — очистить. */
  note?: string | null;
}

/**
 * POST /admin/managers/:id/settlements — расчёт менеджера с владельцем
 * (только суперадмин). `amount > 0` — менеджер передал деньги владельцу (долг
 * уменьшается), `amount < 0` — корректировка (отменяет ошибочно внесённое: долг
 * менеджера растёт), тогда `note` (причина) обязательна. `amount = 0` — 400.
 */
export interface CreateSettlementRequest {
  amount: number;
  note?: string;
  /** 'YYYY-MM-DD'; не передан — сегодня. */
  settledOn?: string;
}

/**
 * POST /manager/tenants — менеджер заводит автосервис ЗА СЕБЯ (`manager_id` = он).
 * Директор обязателен. Пробный доступ: `trialDays` (1..`ManagerSummary.maxFreeDays`)
 * → бесплатная строка в журнале продлений («Пробный период (менеджер)»).
 *
 * Бессрочных автосервисов менеджер не создаёт (у тенанта без `subscriptionEnd` срока
 * нет — это был бы бесплатный доступ мимо журнала и доли владельца), поэтому
 * `trialDays` не передан ⇒ сервер сам выдаёт пробный период по умолчанию
 * `min(14, maxFreeDays)` дней.
 */
export interface CreateManagerTenantRequest {
  name: string;
  phone?: string;
  address?: string;
  /** Тариф автосервиса (`plans.id`). */
  planId: string;
  /** Владелец автосервиса — первая учётная запись роли `director`. */
  director: {
    name: string;
    phone: string;
    /** ≥ 6 символов. */
    password: string;
  };
  /**
   * Пробный доступ, дней: 1..`platform_settings.manager_max_free_days` (по умолчанию 30);
   * больше — 400. Не передан — `min(14, maxFreeDays)` (см. описание типа).
   */
  trialDays?: number;
  /** Заметка менеджера об автосервисе (сохраняется как `subscriptionNote` тенанта). */
  note?: string;
}

/**
 * PATCH /admin/tenants/:tenantId/manager — передать клиента (автосервис) другому
 * менеджеру или снять с менеджера (`null` — клиент владельца). Только суперадмин;
 * менеджер должен быть активным пользователем роли `manager`. История платежей
 * остаётся за тем, кто их провёл, будущие платежи — за новым.
 */
export interface TransferTenantManagerRequest {
  managerId: string | null;
}

/** Response of PATCH /admin/tenants/:tenantId/manager. */
export interface TransferTenantManagerResponse {
  ok: true;
  tenantId: string;
  managerId: string | null;
  /** ФИО нового менеджера; null, если клиента сняли с менеджера. */
  managerName: string | null;
}

/**
 * POST /manager/tenants/:id/reset-owner-password — менеджер сбрасывает пароль владельца
 * своего автосервиса (самого старого активного `director` тенанта). Аудит
 * `owner_password_reset` (пароль в него не попадает).
 */
export interface ResetOwnerPasswordRequest {
  /** ≥ 6 символов. */
  password: string;
}

/** Query of GET /manager/tenants. */
export interface ManagerTenantsQuery {
  /**
   * Фильтр по состоянию подписки; не передан — все свои автосервисы. `'suspended'`
   * главнее `'expired'` (так же, как `Tenant`-статус на сервере). Фильтр «истекает в
   * ближайшие 7 дней» клиент делает сам по `subscriptionEnd`.
   */
  status?: SubscriptionStatus;
}

/**
 * Query of GET /admin/managers/:id/ledger и GET /manager/ledger. `months` — окно лент
 * `payments`/`settlements` в месяцах (по умолчанию 12, сервер ограничивает 1..36);
 * `balance` в ответе всегда за всё время.
 */
export interface ManagerLedgerQuery {
  months?: number;
}

/**
 * PUT /plans/:id/features — replace the plan's ENABLED feature set (superadmin).
 * Keys are validated server-side against the catalog (GET /plans/features-catalog).
 */
export interface SetPlanFeaturesRequest {
  features: string[];
}

export interface CreatePlanRequest {
  name: string;
  monthlyPrice: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  sortOrder?: number;
  /** 115 — пакет минут голосового ввода в месяц (0 = не входит в тариф). */
  voiceMinutes?: number;
}

export interface UpdatePlanRequest {
  name?: string;
  monthlyPrice?: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  isActive?: boolean;
  sortOrder?: number;
  /** 115 — пакет минут голосового ввода в месяц (0 = не входит в тариф). */
  voiceMinutes?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Imports — clients & cars
// ═══════════════════════════════════════════════════════════════════════════
//
// Frontend parses the spreadsheet (xlsx/csv) on the client and sends a JSON
// payload to the backend. One file row = one ImportRowInput (a client paired
// with at most one car). Multiple rows can share the same phone — they get
// folded into one client with multiple cars.

export interface ImportRowInput {
  /** 1-based row number from the source file (used in messages). */
  sourceRow: number;
  clientName?: string | null;
  /** Raw phone exactly as it appeared in the source file. */
  phoneRaw?: string | null;
  /** Normalized phone, if the file already had one. Backend re-normalizes anyway. */
  phone?: string | null;
  carPlate?: string | null;
  carModel?: string | null;
  /**
   * 171 — VIN («car_vin» в шаблоне). Сервер нормализует сам; учитывается
   * ТОЛЬКО при включённой опции Tenant.vinEnabled, иначе молча игнорируется.
   * Невалидный / уже занятый VIN — предупреждение (invalid_vin / duplicate_vin),
   * авто создаётся без VIN.
   */
  carVin?: string | null;
  /** Free-form data-quality tags from the source ("unclear_car_model", "no_phone", …). */
  notes?: string | null;
  /** Original raw client text — preserved for audit. */
  originalClientText?: string | null;
}

/** Per-row issue surfaced in preview. Severity drives the UI section. */
export type ImportIssueKind =
  | 'no_phone'
  | 'invalid_phone'
  | 'no_name'
  | 'no_plate'
  | 'invalid_plate'
  | 'foreign_plate'
  | 'unclear_car_model'
  | 'plate_belongs_to_other_client'
  | 'duplicate_in_file'
  | 'multiple_name_candidates'
  | 'name_conflict_same_phone'
  /** 171 — колонка VIN (только при включённой опции): не распознан / занят другой машиной или повторяется в файле. */
  | 'invalid_vin'
  | 'duplicate_vin';

export interface ImportRowIssue {
  sourceRow: number;
  kind: ImportIssueKind;
  message: string;
  /** Hint about which side of a conflict already exists. */
  existing?: {
    clientId?: string;
    clientName?: string;
    plateNumber?: string;
  };
}

/** Plan for one phone-grouped client computed by preview. */
export interface ImportClientGroup {
  /** Canonical phone (`+7…`). */
  phoneKey: string;
  /** Client name we plan to use. */
  fullName: string;
  /** Matching existing client (if any) — full record, by phone within the tenant. */
  existingClientId?: string | null;
  /** Names present in the file under this phone. */
  candidateNames: string[];
  /** Source rows that contributed to this group. */
  sourceRows: number[];
  cars: ImportPlannedCar[];
}

export interface ImportPlannedCar {
  /** Canonical key for dedup — RU plate w/o spaces or normalized foreign string. */
  plateKey: string;
  /** Display value to be written into `cars.plate_number`. */
  plateDisplay: string;
  /** Will be written into `cars.make_model` (placeholder for unclear). */
  makeModel: string;
  /** Original raw model text — preserved into `cars.comment` if it differs. */
  rawModel?: string | null;
  /** True if plate parsed as foreign / unrecognized RU. */
  isForeign: boolean;
  sourceRow: number;
  /** True if the plate already exists for this tenant. */
  existsForCurrentClient?: boolean;
  /** Set when plate is bound to a different client — preview blocks this row. */
  conflictsWithClientId?: string | null;
  conflictsWithClientName?: string | null;
  /** 171 — VIN, который будет записан при создании (нормализованный); null/absent — без VIN. */
  vin?: string | null;
}

export interface ImportPreviewSummary {
  totalRows: number;
  uniqueClients: number;
  clientsWillCreate: number;
  clientsWillReuse: number;
  carsWillCreate: number;
  carsAlreadyExist: number;
  rowsSkipped: number;
  errors: number;
  warnings: number;
}

export interface ImportPreviewRequest {
  rows: ImportRowInput[];
  options?: ImportOptions;
}

export interface ImportOptions {
  /** Allow `foreign_plate` rows to create cars (default true). */
  allowForeignPlates?: boolean;
}

export interface ImportPreviewResponse {
  summary: ImportPreviewSummary;
  groups: ImportClientGroup[];
  issues: ImportRowIssue[];
  /** Rows that were dropped before grouping (no phone, invalid phone, etc.). */
  skippedRows: Array<{ sourceRow: number; reason: ImportIssueKind; message: string }>;
}

export interface ImportConfirmRequest {
  rows: ImportRowInput[];
  options?: ImportOptions;
}

export interface ImportConfirmResponse {
  importRunId: string;
  summary: ImportPreviewSummary;
  createdClientIds: string[];
  createdCarIds: string[];
  reusedClientIds: string[];
  /** Rows that were skipped despite confirmation (e.g. plate stolen between preview and confirm). */
  skipped: Array<{ sourceRow: number; reason: ImportIssueKind; message: string }>;
}

// ───────────────────────────────────────────────────────────────────────
//  Knowledge Base requests (063_knowledge_base)
// ───────────────────────────────────────────────────────────────────────

export interface KnowledgeCategoryInput {
  name: string;
  /** Ionicons name for the UI. */
  icon?: string | null;
  sortOrder?: number;
  /**
   * Parent category for folders/subfolders (079). Pass null (on update) to move
   * the category back to the root. The server rejects cycles with a 400.
   */
  parentId?: string | null;
}

export interface KnowledgeArticleInput {
  title: string;
  /** Markdown body. Kept alongside `blocks` for fallback rendering. */
  body?: string;
  /**
   * Block-based content (079) — ordered text/heading/image/VK-video blocks. Pass
   * [] to clear blocks (renderers then fall back to `body`). `body` is never
   * replaced by setting `blocks`. Each block is deep-validated server-side;
   * unknown types or non-VK video URLs are rejected with a 400.
   */
  blocks?: KnowledgeBlock[];
  type?: KnowledgeArticleType;
  /** Pass null to clear the category on update. */
  categoryId?: string | null;
  coverImage?: string | null;
  attachments?: KnowledgeAttachment[];
  pinned?: boolean;
  /**
   * Visibility. `published: false` HIDES the article from regular employees
   * (#54 «Скрыть») — it disappears from their lists/search/detail — while
   * managers still see it and can un-hide by sending `published: true`. There is
   * no separate `hidden` flag; this single flag is the hide switch.
   */
  published?: boolean;
  // ─── Регламенты+ (064) ────────────────────────────────────────────────────
  /** Regulation must be acknowledged by the audience. */
  mandatory?: boolean;
  /** ISO date; pass null to clear. */
  dueDate?: string | null;
  /** Car-make tag for contextual KB; pass null to clear. */
  carMake?: string | null;
  /**
   * Update only: force a version bump (re-requires acknowledgment). A real body
   * change auto-bumps a regulation even without this flag.
   */
  bumpVersion?: boolean;
  // ─── Regulation targeting / audience (#54) ────────────────────────────────
  /**
   * Audience of a regulation. `true` (default) = «для всех сотрудников»; `false`
   * = only the employees in `targetUserIds` see it and must acknowledge. Omit to
   * keep the current audience (on update). Only meaningful for type='regulation'.
   * A non-empty `targetUserIds` without `targetAll` implies `targetAll: false`.
   */
  targetAll?: boolean;
  /**
   * Selected employees when `targetAll` is false. On update, this REPLACES the
   * target set (send `[]` to target nobody); omit to leave it unchanged. Ids
   * that are not real tenant users are silently dropped server-side.
   */
  targetUserIds?: string[];
}

export interface ListArticlesParams {
  categoryId?: string;
  type?: KnowledgeArticleType;
  /** Free-text — matched against title + body via pg_trgm. */
  search?: string;
  /** Send 'true' to return only pinned articles. */
  pinned?: 'true' | 'false';
  /**
   * Optional facet — keep only articles that carry at least one attachment of
   * this kind (e.g. 'video' for "статьи с видео"). Additive: omit to leave the
   * existing search/listing untouched.
   */
  hasAttachmentType?: 'image' | 'video' | 'document';
}

// ───────────────────────────────────────────────────────────────────────
//  Learning center requests (064)
// ───────────────────────────────────────────────────────────────────────

export interface KnowledgeCourseInput {
  title: string;
  description?: string;
  coverImage?: string | null;
  /** Pass null to clear on update. */
  categoryId?: string | null;
  published?: boolean;
  sortOrder?: number;
}

export interface KnowledgeLessonInput {
  title: string;
  /** Markdown. */
  body?: string;
  sortOrder?: number;
  /** Full quiz incl. correctIndex (manager). Pass null to clear. */
  quiz?: KnowledgeQuizQuestion[] | null;
}

export interface CompleteLessonInput {
  /** Answer index per quiz question — required only when the lesson has a quiz. */
  answers?: number[];
}

// ───────────────────────────────────────────────────────────────────────
//  Troubleshooting requests (064)
// ───────────────────────────────────────────────────────────────────────

export interface TroubleshootingInput {
  title: string;
  system?: string | null;
  carMake?: string | null;
  symptom?: string;
  cause?: string;
  solution?: string;
  severity?: TroubleshootingSeverity | null;
  tags?: string[];
}

export interface ListTroubleshootingParams {
  /** Free-text — matched against title/symptom/cause/solution via pg_trgm. */
  search?: string;
  system?: string;
  carMake?: string;
  tag?: string;
}

export interface ForCarParams {
  make?: string;
  model?: string;
}

// ─── Расходы (2026-09-30: «за какой месяц») ──────────────────────────────────

/**
 * POST /expenses.
 *
 * `periodMonth` ('YYYY-MM') — месяц, К КОТОРОМУ относится расход («аренда за
 * сентябрь, оплачена в октябре»). Отчёты и прибыль считают расход в этом месяце;
 * лента «Расходы», касса и «Движение денег» — по `date` (дате оплаты). Без
 * `periodMonth` (или `null`) расход относится к месяцу `date`.
 */
export interface CreateExpenseRequest {
  categoryId?: string;
  amount: number;
  description?: string;
  /** ISO 8601; по умолчанию — «сейчас». */
  date?: string;
  /** Формат `/^\d{4}-\d{2}$/`; `null` = месяц даты факта. */
  periodMonth?: string | null;
}

/**
 * PATCH /expenses/:id — передаются только изменяемые поля.
 *
 * `periodMonth` можно менять/снимать (`null`) ТОЛЬКО у строк, не связанных с
 * выплатами зарплаты (не категория «Зарплата», нет привязки к
 * `salary_payouts` / `salary_payments`): месяц зеркального расхода выплаты
 * определяется самой выплатой. Для связанной строки значение `periodMonth`,
 * совпадающее с текущим, сервер игнорирует, отличающееся — отвечает 400.
 */
export interface UpdateExpenseRequest {
  categoryId?: string | null;
  amount?: number;
  description?: string;
  date?: string;
  /** Формат `/^\d{4}-\d{2}$/`; `null` снимает назначенный месяц. */
  periodMonth?: string | null;
}

// ─── Записи (bookings) ───────────────────────────────────────────────────────

/** GET /bookings query. */
export interface ListBookingsParams {
  scope?: 'upcoming' | 'past';
  /** ISO 8601 lower bound on scheduled_at. */
  from?: string;
  /** ISO 8601 upper bound on scheduled_at. */
  to?: string;
}

/** POST /bookings body. */
export interface CreateBookingRequest {
  requestId?: string;
  durationMinutes?: number;
  clientId: string;
  carId?: string | null;
  /** Omit when a master books for self; admin/owner may set any master or null. */
  masterId?: string | null;
  /** ISO 8601 date+time. */
  scheduledAt: string;
  comment?: string;
  notifyOnCreate?: boolean;
}

/** PATCH /bookings/:id body (reschedule / comment / reassign). */
export interface UpdateBookingRequest {
  requestId?: string;
  durationMinutes?: number;
  scheduledAt?: string;
  comment?: string;
  masterId?: string | null;
  carId?: string | null;
}

/** POST /bookings/:id/convert body. */
export interface ConvertBookingRequest {
  requestId?: string;
  checkId: string;
}

export interface BookingOperationRequest {
  requestId: string;
}
export interface LinkBookingClientRequest extends BookingOperationRequest {
  clientId: string;
}
export interface ApprovePublicBookingRequest extends BookingOperationRequest {
  resourceId?: string;
}
export interface PutPublicBookingSettingsRequest extends BookingOperationRequest {
  /** 0 for the first draft; otherwise the last read server revision. Slug is immutable after creation. */
  revision: number;
  slug?: string;
  displayName: string;
  address: string;
  contacts: string;
  links?: { phone?: string; instagram?: string; whatsapp?: string; vk?: string; telegram?: string };
  showPrices: boolean;
  mode: PublicBookingMode;
  slotStepMinutes?: number;
  openingHours?: PublicBookingHours;
  operator?: PublicBookingOperator;
  policyText?: string;
  consentText?: string;
  services: Array<{ serviceId: string; durationMinutes?: number }>;
  resourceIds: string[];
}
export interface PublicBookingSlotsParams {
  /** Tenant-local dates, inclusive; at most 31 days. */
  from: string;
  to: string;
  serviceIds: string[];
  after?: string;
  resourceKey?: string;
}
export interface SubmitPublicBookingRequest extends BookingOperationRequest {
  /** Secure random 32-byte base64url capability, generated and retained BEFORE POST. Never put it in a URL/log. */
  recoveryToken: string;
  serviceIds: string[];
  startsAt: string;
  /** Page-scoped opaque identifier of a master explicitly offered on this public page. */
  resourceKey?: string;
  name: string;
  phone: string;
  comment?: string;
  consentVersion: string;
  consentAccepted: true;
}

/** PATCH /bookings/settings body — all fields optional. */
export interface UpdateBookingSettingsRequest {
  notifyClientOnCreate?: boolean;
  reminderEnabled?: boolean;
  reminderHours?: number;
  channel?: 'auto' | 'sms' | 'whatsapp';
}

// ─── «Мой профиль» (migration 099) ──────────────────────────────────────────────

/**
 * PATCH /profile body — self edit of ФИО / телефон / аватар. All optional
 * (send only what changed). NEVER carries a password (own self-service path).
 * `avatar: ''` clears the avatar.
 */
export interface UpdateProfileRequest {
  fullName?: string;
  phone?: string;
  avatar?: string;
}

/** Which branch the self-edit took (keyed off the caller's role server-side). */
export type ProfileUpdateOutcome = 'applied' | 'requested';

/**
 * PATCH /profile result.
 *   - 'applied'   (director/superadmin) → `user` is the updated canonical user.
 *   - 'requested' (admin/master)        → `request` is the created/superseded
 *                                          pending change request.
 */
export interface UpdateProfileResponse {
  status: ProfileUpdateOutcome;
  /** Convenience boolean: true when applied directly, false when a request was created. */
  applied: boolean;
  user?: User;
  request?: ProfileChangeRequest;
}

/**
 * POST /profile/password body — self-service for every role. The server
 * verifies `currentPassword` (bcrypt.compare) and stores bcrypt.hash(new, 12).
 * Passwords are never logged or returned.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Authenticated self-scan. User, point and time are exclusively server-owned. */
export interface AttendanceNfcScanRequest {
  token: string;
  /** Reuse this UUID and the exact token on retry. */
  requestId: string;
}
