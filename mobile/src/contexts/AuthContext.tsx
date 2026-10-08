import { loadProductCatalog } from '../../../shared/api/productCatalog';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
// Same alias style as CheckCreateScreen — expo-image is cross-platform, and
// its static cache-clear methods are the only thing this file needs.
import { Image as ExpoImage } from 'expo-image';
import type { QueryClient } from '@tanstack/react-query';
import { authApi } from '../api/services';
import * as serviceFactories from '../../../shared/api/createServices';
import api, {
  beginSessionReissueWindow,
  captureAuthSession,
  createSessionBoundClient,
  createCapturedAuthRequester,
  onApiRouteReady,
  onAuthExpired,
  onRequestSucceeded,
  reselectApiHost,
  setAuthToken,
} from '../api/axios';
import { addSentryBreadcrumb, captureException, isTransientPushError } from '../sentry';
import { clearWidgetData } from '../utils/widgetBridge';
import { clearAccountCaches, setPersistentCacheSession } from '../utils/persistentCache';
import { inspectSavedAccountRemoval, type AccountRemovalInspection } from './accountRemoval';
import {
  adoptOfflineCheckQueue,
  endOfflineCheckQueueSession,
  setOfflineCheckQueuePointId,
  stampOfflineCheckQueuePoint,
  type QueueOwner,
} from '../utils/offlineCheckQueue';
import { toLocalISODate } from '../utils/dates';
import { PRODUCT_LIST_FIELDS, PRODUCT_LIST_LIMIT } from '../constants/productFields';
import {
  createSessionEpochRuntime,
  createSessionRecoveryBackoff,
  runSessionRecoveryAttempt,
  type SessionEpochRuntime,
} from './authSessionRuntime';
import { authAccounts, readStoredAccountSession, secureAccountStorage } from './authAccountStorage';
import { createPushSessionLifecycle } from './pushSessionLifecycle';
import { attachSessionMutationBoundary } from './sessionQueryBoundary';
import { resetLiveActivitySession } from '../utils/liveActivityStore';
import {
  AccountRegistryError,
  accountSummaries,
  activeAccount,
  type AccountRegistry,
  type SavedAccountSummary,
} from './accountRegistry';
import { setDataSession, userDataOwner } from './dataSession';
import { createForegroundProfileRefreshController } from './foregroundProfileRefresh';
import type { User, UserPermissions, UserRole } from '../../../shared/types';
import type { LoginPointOption } from '../../../shared/api/types';

/**
 * ЧТО ОТВЕТИЛ ШАГ 1 ВХОДА (163). Экран входа обязан различать два исхода
 * ОДНОГО нажатия «Войти»:
 *   • `authenticated` — сессия уже установлена (одноточечный автосервис либо
 *     сотруднику доступен ровно один филиал), экран просто исчезает;
 *   • `point-required` — пароль верен, но сессия ещё НЕ создана: филиал
 *     выбирается вторым шагом. Токена здесь нет и быть не может — сессия без
 *     филиала это и есть убранный режим «все филиалы».
 */
export type LoginStepResult =
  | { status: 'authenticated' }
  | {
      status: 'point-required';
      /** In-memory immutable attempt ownership; never persist this or the select token. */
      operation: AccountLoginHandle;
      /** Одноразовый промежуточный токен; живёт минуты, в обычные ручки не ходит. */
      selectToken: string;
      /** Момент, после которого сервер откажет: считаем из expiresIn при получении. */
      expiresAt: number;
      /** Доступные сотруднику живые филиалы; основной сервис первым (порядок сервера). */
      points: LoginPointOption[];
      /** Где человек работал в прошлый раз — подсветить, но НЕ выбирать за него. */
      defaultPointId: string;
    };

export interface AccountLoginHandle {
  readonly id: number;
}
export interface AccountLoginOptions {
  reauthAccountId?: string;
}
interface AuthContextType {
  savedAccounts: readonly SavedAccountSummary[];
  activeAccountId: string | null;
  sessionGeneration: number;
  addAccount: (phone: string, password: string, options?: AccountLoginOptions) => Promise<LoginStepResult>;
  completeAccountLogin: (operation: AccountLoginHandle, pointId: string) => Promise<void>;
  cancelAccountLogin: (operation: AccountLoginHandle) => void;
  switchAccount: (accountId: string) => Promise<void>;
  inspectAccountRemoval: (accountId: string) => Promise<AccountRemovalInspection>;
  removeAccount: (accountId: string) => Promise<void>;
  user: User | null;
  token: string | null;
  loading: boolean;
  /** Stored bearer exists, but /me is still waiting for a usable API route. */
  recoveringSession: boolean;
  /** A non-blocking /me recovery attempt is currently in flight. */
  sessionRecoveryPending: boolean;
  retrySessionRecovery: () => void;
  /**
   * ШАГ 1 ВХОДА: телефон + пароль. Возвращает, закончился ли вход (сессия
   * установлена) или требуется выбор филиала — см. {@link LoginStepResult}.
   */
  login: (phone: string, password: string) => Promise<LoginStepResult>;
  /**
   * ШАГ 2 ВХОДА: обменять промежуточный токен и выбранный филиал на сессию.
   * Пароль здесь не нужен — он проверен на шаге 1. Бросает ошибку axios как
   * есть: разбор кодов живёт в screens/loginPointSelection.ts (чистая
   * функция с тестами), потому что от него зависит, куда вести человека.
   */
  loginWithPoint: (selectToken: string, pointId: string) => Promise<void>;
  /**
   * МГНОВЕННАЯ СМЕНА ФИЛИАЛА РУКОВОДИТЕЛЕМ (167) — без выхода и без пароля.
   *
   * Это НЕ вход и НЕ повышение прав: личность подтверждена живой сессией,
   * сервер лишь перевыпускает токен на другой филиал, к которому у человека
   * уже есть доступ, и НЕМЕДЛЕННО гасит прежний. Поэтому новый токен
   * применяется ровно тем же атомарным путём, что и после входа: кеш прошлого
   * филиала в памяти очищается, а диск остаётся в отдельном пространстве
   * исходного tenant/user/point. Новый bearer всегда получает новую эпоху.
   *
   * Зовётся ТОЛЬКО из раздела «Филиалы» (требование владельца). Право
   * `user_management` перепроверяет сервер — клиентский гейт лишь прячет
   * кнопку от сотрудника, которому она ответит отказом.
   *
   * Бросает ошибку axios как есть: разбор кодов живёт в screens/pointSwitch.ts
   * (чистая функция с тестами), потому что от него зависит, куда вести
   * человека — остаться, обновить список или идти на вход.
   */
  switchSessionPoint: (pointId: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
  /**
   * True while the superadmin is impersonating a tenant owner (a 30-min
   * director token is installed instead of the superadmin's own). Drives the
   * persistent «Вы вошли как …» banner.
   */
  isImpersonating: boolean;
  /**
   * Swap the stored auth token for the short-lived director token returned by
   * `tenantsApi.impersonate(id)` and set the session to that owner. The app
   * re-renders into the tenant's car-service tree because the role becomes
   * 'director'. Reuses the exact cross-tenant isolation flow `login()` uses.
   */
  beginImpersonation: (token: string, user: User) => Promise<void>;
  /**
   * End impersonation. The short-lived token has no superadmin credentials to
   * restore, so this is a hard logout back to the login screen — the
   * superadmin signs in again (stated in the confirm dialog before starting).
   */
  endImpersonation: () => void;
  /**
   * ПОЧЕМУ СЕССИЯ ЗАКОНЧИЛАСЬ — текст сервера, если это был не просто
   * истёкший токен, а снятый доступ к филиалу или закрытый филиал (163).
   * Экран входа показывает его один раз и гасит: без причины человека просто
   * «выкидывает», и он не понимает, что делать дальше.
   */
  sessionEndedNotice: string | null;
  /** Погасить причину (показали — забыли), чтобы она не всплыла второй раз. */
  clearSessionEndedNotice: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Ordinary switches retain the previous owner's durable queue and cache. */
function adoptTenantStorage(owner: QueueOwner): Promise<void> {
  return adoptOfflineCheckQueue(owner);
}
function endTenantStorage(): Promise<void> {
  setPersistentCacheSession(null);
  return endOfflineCheckQueueSession();
}

/** Владелец офлайн-очереди по профилю сессии. */
function queueOwnerOf(u: User): QueueOwner {
  return { userId: u.id, tenantId: u.tenantId ?? null, pointId: u.currentPointId };
}

/** True when an axios error is a genuine 401 (session expired / revoked). */
function isAuthExpiry(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 401;
}

// ── Тихое продление сессии ──────────────────────────────────────────────────
// Токен живёт фиксированный TTL и раньше НИКОГДА не продлевался: пользователь,
// открывающий приложение каждый день, всё равно упирался в принудительный
// logout по exp (Sentry-метрика auth_expired_forced_logout). После успешного
// /auth/me на bootstrap'е токен старше этого порога молча меняется на свежий
// через POST /auth/refresh. Порог 7 дней: продление редкое (не на каждый
// старт), но с огромным запасом до 30-дневного exp.
const SESSION_REFRESH_AGE_MS = 7 * 86_400_000;

/** Паузы между попытками продления. Три попытки, ~0,55 с суммарного ожидания. */
const SESSION_REFRESH_RETRY_DELAYS_MS = [150, 400];

/**
 * Идущее продление. Обмен токена ОДНОРАЗОВЫЙ: сервер «клеймит» jti через
 * ON CONFLICT DO NOTHING, поэтому два параллельных /auth/refresh — это
 * гарантированный проигрыш одного из них с «Токен отозван». Держим
 * единственный полёт и отдаём его всем желающим.
 */
let sessionRefreshInFlight: { epoch: number; promise: Promise<string | null> } | null = null;

/**
 * Продлить сессию. Возвращает новый токен или null.
 *
 * Почему с ретраями. Сервер продлевает по схеме «сначала погасить, потом
 * выдать» (backend/src/auth/auth.service.ts): старый токен уходит в blacklist
 * ДО того, как новый уедет на телефон. Значит потерянный ответ — это не
 * «попробуем в следующий раз», а мёртвая сессия: у клиента на руках токен,
 * который сервер уже считает отозванным, и человека выбросит на вход через
 * AUTH_CACHE_TTL плюс grace. Раньше здесь была ровно ОДНА попытка с пустым
 * catch, а комментарий рядом уверял, что «текущий токен остаётся валидным до
 * своего exp» — это было неправдой.
 *
 * Повторяем ТОЛЬКО транспортные отказы: если ответ не доехал, есть шанс, что и
 * запрос не дошёл — тогда повтор спасает. На 401 повтор бессмысленен: наш jti
 * уже заклеймён, второй раз его не обменять.
 */
async function refreshSessionToken(): Promise<string | null> {
  const lease = captureAuthSession();
  if (!lease.token) return null;
  if (sessionRefreshInFlight?.epoch === lease.epoch) return sessionRefreshInFlight.promise;
  const bound = createSessionBoundClient(lease.token);
  const flight = { epoch: lease.epoch, promise: Promise.resolve<string | null>(null) };
  flight.promise = (async () => {
    for (let attempt = 0; lease.isCurrent(); attempt++) {
      try {
        const res = await bound.post<{ token?: string }>('/auth/refresh');
        return lease.isCurrent() && typeof res.data?.token === 'string' ? res.data.token : null;
      } catch (err) {
        if (!lease.isCurrent() || isAuthExpiry(err) || attempt >= SESSION_REFRESH_RETRY_DELAYS_MS.length) return null;
        await sleep(SESSION_REFRESH_RETRY_DELAYS_MS[attempt]);
      }
    }
    return null;
  })().finally(() => {
    if (sessionRefreshInFlight === flight) sessionRefreshInFlight = null;
  });
  sessionRefreshInFlight = flight;
  return flight.promise;
}

/**
 * iat-клейм JWT в миллисекундах. Payload декодируется БЕЗ верификации подписи
 * — подпись проверяет сервер на каждом запросе; здесь только локальное
 * решение «пора ли просить свежий токен». null — токен не парсится / нет iat /
 * нет atob: тогда просто не продлеваем (и ничего не ломаем).
 */
function jwtIssuedAtMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part || typeof atob !== 'function') return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const iat = (JSON.parse(json) as { iat?: unknown }).iat;
    return typeof iat === 'number' && Number.isFinite(iat) ? iat * 1000 : null;
  } catch {
    return null;
  }
}

// One cold-start deadline for storage restore + the complete API-ring attempt.
// The axios layer already traverses every healthy candidate, so retrying /me
// here would multiply its worst case (3 manual attempts × 3 hosts). Fifteen
// seconds covers the observed 5–6s cold TLS path plus `/me`, while a total
// ring outage still cannot pin the native splash indefinitely.
export const AUTH_BOOTSTRAP_BUDGET_MS = 15_000;
const SESSION_RECOVERY_BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];
// Three physical /me attempts at 8s fit inside this total recovery window,
// with room for a manual fresh-route health pass (~9s) when needed.
export const SESSION_RECOVERY_BUDGET_MS = 35_000;
export const SESSION_RECOVERY_HOST_TIMEOUT_MS = 8_000;

interface AuthProviderProps {
  children: ReactNode;
  /**
   * Optional QueryClient. When provided we kick off prefetches for the
   * heavy reference data (warehouse, services, users) right after a
   * successful login so the user perceives subsequent screens as instant.
   */
  queryClient?: QueryClient;
  /**
   * Fired once when the initial auth check finishes — regardless of
   * outcome. Lets `App.tsx` time the splash dismissal precisely instead
   * of relying on an in-tree spinner.
   */
  onAuthResolve?: () => void;
}

/**
 * Fire-and-forget prefetch of cacheable reference data.
 * Errors are swallowed — they'll surface naturally when the screen mounts.
 *
 * ROLE HYGIENE (prod incident 2026-06): this fan-out used to fire for EVERY
 * role identically. Under a master that meant a wave of owner-only requests
 * (`/checks/dashboard`, `/products/low-stock`, `/calls?date=…`) competing
 * with the queries the master dashboard actually needs (`/salary/my`,
 * `/shifts/my`) — and `/calls` is a guaranteed 400 on tenants without the
 * МоиЗвонки integration (a 4xx is deterministic, so the retry policy never
 * retries it — see utils/queryRetry.ts). Every prefetch below is now
 * gated by the same role/permission rules the screens themselves use
 * (mirrors `hasPermission` further down this file): a master session fires
 * ZERO requests it isn't allowed to make or has no screen for.
 */
function prefetchAfterLogin(qc: QueryClient, user: User): void {
  const lease = captureAuthSession();
  if (!lease.token || !lease.isCurrent()) return;
  const bound = createSessionBoundClient(lease.token);
  const productsApi = serviceFactories.createProductsApi(bound);
  const servicesApi = serviceFactories.createServicesApi(bound);
  const usersApi = serviceFactories.createUsersApi(bound);
  const warehouseCategoriesApi = serviceFactories.createWarehouseCategoriesApi(bound);
  const warehousesApi = serviceFactories.createWarehousesApi(bound);
  const suppliersApi = serviceFactories.createSuppliersApi(bound);
  const clientsApi = serviceFactories.createClientsApi(bound);
  const carsApi = serviceFactories.createCarsApi(bound);
  const equipmentApi = serviceFactories.createEquipmentApi(bound);
  const checksApi = serviceFactories.createChecksApi(bound);
  const callsApi = serviceFactories.createCallsApi(bound);
  const subscriptionApi = serviceFactories.createSubscriptionApi(bound);
  const scheduleApi = serviceFactories.createScheduleApi(bound);
  const pointsApi = serviceFactories.createPointsApi(bound);

  // Менеджер платформы без своего автосервиса: складу/клиентам/чекам нечего греть — каждый запрос ниже был бы 403.
  if (user.role === 'manager') return;
  // Mirror of AuthContext.hasPermission (the canonical helper): director and
  // superadmin implicitly hold every permission; admin/master fall back to
  // the explicit permissions object from /auth/me.
  const can = (perm: keyof UserPermissions): boolean =>
    user.role === 'superadmin' || user.role === 'director' || !!user.permissions?.[perm];
  // Owner-side dashboard (AdminDashboard in DashboardScreen) mounts for
  // director / superadmin / admin — masters render MasterDashboard, which
  // never reads the owner widget keys prefetched under this flag.
  const isOwnerSide = user.role === 'director' || user.role === 'superadmin' || user.role === 'admin';

  // NOTE: there is deliberately NO un-scoped ['products', { search, limit }]
  // prefetch here. ProductsScreen's real key includes the resolved main
  // `warehouseId` (see the warehouse-scoped prefetch below, fired once
  // `['warehouses']` resolves) — the un-scoped slot was a structural MISS
  // nothing ever read, costing a full heavy products payload on every login.

  // ФИЛИАЛ СЕССИИ (163) — ['points'], тот же ключ, что читает индикатор
  // автосервиса на Кассе, главной и в Журнале. Греем его сразу после входа:
  // логин ЧИСТИТ персистентный кеш (иначе после входа в другой филиал мелькнут
  // чужие цифры), поэтому без прогрева первый кадр Кассы шёл бы без подписи
  // автосервиса — ровно там, где цена ошибки максимальна. Ответ лёгкий:
  // справочник точек, без денег.
  qc.prefetchQuery({
    queryKey: ['points'],
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  }).catch(() => {});

  // Mirror key for the cash-side product picker. `ProductPickerModal`
  // reads `['all-products-check']` so opening the picker is a cache hit
  // on the first try right after login. Different shape (flat array)
  // than the warehouse `['products', ...]` key, so a separate prefetch
  // is needed instead of aliasing.
  qc.prefetchQuery({
    queryKey: ['all-products-check'],
    queryFn: async () => {
      return loadProductCatalog(productsApi.getAll);
    },
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Legacy / fallback cache slot — server falls back to main warehouse
  // when no warehouseId is provided, so this prefetch covers callers
  // that haven't migrated to the warehouse-scoped key yet.
  qc.prefetchQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => (await warehouseCategoriesApi.getAll()).data,
    staleTime: 10 * 60_000,
  }).catch(() => {});

  // Warehouses (3 rows: main/defect/used). Warehouse switcher in
  // ProductsScreen reads this — prefetch so the picker can render
  // synchronously even on a cold start. Once the warehouses list
  // resolves we also pre-warm the main-warehouse categories key so
  // `ProductsScreen` / `CheckCreateScreen` hit cache on first render.
  qc.prefetchQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 10 * 60_000,
  })
    .then(() => {
      const warehouses = qc.getQueryData<Array<{ id: string; kind: 'main' | 'defect' | 'used' }>>(['warehouses']);
      const main = warehouses?.find((w) => w.kind === 'main');
      if (main?.id) {
        qc.prefetchQuery({
          queryKey: ['warehouse-categories', { warehouseId: main.id }],
          queryFn: async () => (await warehouseCategoriesApi.getAll(main.id)).data,
          staleTime: 10 * 60_000,
        }).catch(() => {});

        // Склад first-open cache HIT. ProductsScreen reads
        //   ['products', { search: '', limit: PRODUCT_LIST_LIMIT, warehouseId: <main.id> }]
        // (it defaults to the main warehouse). Warming the EXACT
        // warehouse-scoped key here makes the first Склад open instant.
        // `fields` mirrors the screen's slim `?fields=` projection (shared
        // PRODUCT_LIST_FIELDS constant) so the prefetched payload is
        // byte-identical to what the screen itself would fetch — without it
        // the prefetch pulled the heavy unprojected shape (bundle_items
        // JSONB, nested supplier) the list never renders.
        qc.prefetchQuery({
          queryKey: ['products', { search: '', limit: PRODUCT_LIST_LIMIT, warehouseId: main.id }],
          queryFn: async () => {
            const res = await productsApi.getAll({
              search: '',
              page: 1,
              limit: PRODUCT_LIST_LIMIT,
              warehouseId: main.id,
              fields: PRODUCT_LIST_FIELDS,
            } as Parameters<typeof productsApi.getAll>[0] & { fields: string });
            return res.data;
          },
          staleTime: 5 * 60_000,
        }).catch(() => {});
      }
    })
    .catch(() => {});

  qc.prefetchQuery({
    queryKey: ['all-services'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 500 });
      return res.data?.data || res.data;
    },
    staleTime: 10 * 60_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['all-users'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Mirror key 'users' since some screens use it instead of 'all-users'
  qc.prefetchQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Suppliers / clients / cars / equipment — heavy reference lists; user
  // perceives screens as instant when these are warm. Suppliers is
  // permission-gated in MoreScreen (`suppliers_access`) — a master without
  // it has no screen that reads this key, so don't burn the request.
  if (can('suppliers_access')) {
    qc.prefetchQuery({
      queryKey: ['suppliers', ''],
      queryFn: async () => {
        const res: any = await suppliersApi.getAll({ search: '' });
        return res.data?.data ?? res.data ?? [];
      },
      staleTime: 5 * 60_000,
    }).catch(() => {});
  }

  // ClientsScreen reads via `useInfiniteQuery` keyed
  //   ['clients-infinite', { search: '', filter: 'all', source: null }]
  // (defaults: empty search, «Все» filter, no source filter — see
  // ClientsScreen). The old plain ['clients', …] prefetch landed in a slot
  // nothing reads. Mirror the screen's EXACT key + page-1 request
  // (limit 20, `source: null` — NOT '') so the first open is a cache HIT.
  // Both keys feed the Clients screen, gated by `clients_view` in MoreScreen.
  if (can('clients_view')) {
    qc.prefetchInfiniteQuery({
      queryKey: ['clients-infinite', { search: '', filter: 'all', source: null }],
      initialPageParam: 1,
      queryFn: async ({ pageParam = 1 }) =>
        (await clientsApi.getAll({ search: '', page: pageParam as number, limit: 20 })).data,
      staleTime: 5 * 60_000,
    }).catch(() => {});

    qc.prefetchQuery({
      queryKey: ['cars', { search: '', page: 1, limit: 50 }],
      queryFn: async () => (await carsApi.getAll({ search: '', page: 1, limit: 50 })).data,
      staleTime: 5 * 60_000,
    }).catch(() => {});
  }

  qc.prefetchQuery({
    queryKey: ['eq-summary'],
    queryFn: async () => (await equipmentApi.getSummary()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ── Journal (Чеки) — owner explicitly reported this list opens
  // slowly with a flash of empty. ChecksScreen reads via
  // `useInfiniteQuery`, NOT `useQuery`, so the previous `['checks', …]`
  // prefetch landed in a slot nothing reads (React Query compares keys
  // structurally → a dead slot). Match the EXACT default infinite key
  // the screen uses for the first page with no filters:
  //   ['checks-infinite', search='', dateFrom='', dateTo='', masterId='']
  // with `prefetchInfiniteQuery` + the same `initialPageParam` and a
  // queryFn that mirrors the screen's page-1 request (limit=20). This
  // way the screen's first render is a cache HIT. Persistent cache
  // ('checks-infinite' is in PERSISTED_KEYS) carries it across cold
  // starts; this prefetch warms the slot on the first login.
  qc.prefetchInfiniteQuery({
    queryKey: ['checks-infinite', '', '', '', ''],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const res = await checksApi.getAll({ page: pageParam as number, limit: 20 });
      return res.data;
    },
    staleTime: 60_000,
  }).catch(() => {});

  // ChecksScreen's master-filter dropdown uses a separate key so the
  // dropdown opens populated even before the user touches anything.
  qc.prefetchQuery({
    queryKey: ['users-for-filter'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // EmployeesScreen uses 'users-all' (separate key from 'users' /
  // 'all-users' to avoid invalidation cross-talk). Prefetch so the
  // More → Сотрудники screen is instant.
  qc.prefetchQuery({
    queryKey: ['users-all'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ServicesScreen first page (default filters: search='', page=1, limit=30).
  qc.prefetchQuery({
    queryKey: ['services', { search: '', page: 1, limit: 30 }],
    queryFn: async () => (await servicesApi.getAll({ search: '', page: 1, limit: 30 })).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Owner-dashboard-only widgets (LowStockCard / CallsSnapshot in
  // DashboardScreen's AdminDashboard). Masters never mount these widgets and
  // never read these keys — prefetching under a master was pure waste, and
  // `/calls` is a guaranteed 400 on tenants without the МоиЗвонки
  // integration (a 4xx is never retried by the transient-retry policy),
  // polluting the master login.
  //
  // NOTE: the former ['checks-dashboard'] prefetch was removed entirely —
  // no `useQuery` anywhere in mobile/src reads that key any more (only
  // write-side invalidations reference it), so it was a dead request on
  // every login for every role.
  if (isOwnerSide) {
    qc.prefetchQuery({
      queryKey: ['low-stock'],
      queryFn: async () => (await productsApi.getLowStock()).data,
      staleTime: 60_000,
    }).catch(() => {});

    // LOCAL date — `toISOString()` is UTC and pointed the «Звонки сегодня»
    // prefetch at yesterday's slot after local midnight in RU timezones.
    const today = toLocalISODate();
    qc.prefetchQuery({
      queryKey: ['calls-summary', today],
      queryFn: async () => (await callsApi.getCalls({ date: today })).data.summary,
      staleTime: 60_000,
    }).catch(() => {});
  }

  // Subscription gates the entire app (FeatureGate paywall). Prefetch it
  // so the first protected screen doesn't flash the loading state.
  qc.prefetchQuery({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ScheduleScreen's first paint shows "today's shifts". Prefetch the
  // current week so even the schedule tab is instant on open.
  qc.prefetchQuery({
    queryKey: ['schedule-today'],
    queryFn: async () => (await scheduleApi.getToday()).data,
    staleTime: 60_000,
  }).catch(() => {});

  // Push token registration — fire-and-forget, never blocks login.
  registerPushToken().catch(() => {});
}

const pushLifecycle = createPushSessionLifecycle(secureAccountStorage, {
  register: async ({ bearer, deviceToken, platform }) => {
    const response = await createCapturedAuthRequester(bearer)<{ registered?: boolean }>({
      method: 'post',
      url: '/push/token',
      data: { token: deviceToken, platform },
    });
    return response.data;
  },
  logout: async (bearer) => {
    await createCapturedAuthRequester(bearer)({ method: 'post', url: '/auth/logout' });
  },
  unregister: async ({ bearer, deviceToken }) => {
    await createCapturedAuthRequester(bearer)({ method: 'delete', url: '/push/token', data: { token: deviceToken } });
  },
});

// Тихий ретрай получения Expo push-токена: ТОЛЬКО для transient-кодов
// expo-notifications (сеть/5xx до Expo push service — isTransientPushError).
// 3 физические попытки: сразу → ~5с → ~30с. Вызов fire-and-forget из
// prefetchAfterLogin, так что хвост бэкоффа ничего не блокирует.
const PUSH_TOKEN_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Is this build configured for Android push at all?
 *
 * Without a Firebase project (`android.googleServicesFile` in the app config →
 * google-services.json in the build) `getExpoPushTokenAsync` throws «Default
 * FirebaseApp is not initialized» on every login and floods Sentry.
 *
 * Round 14 changed the SHAPE of that guard: it used to be an unconditional
 * `return` for Android, so the day Firebase gets configured Android push would
 * still have been dead with nothing pointing at this line. Now the gate is the
 * ACTUAL config value — add googleServicesFile and Android starts registering
 * with no code change.
 */
export function isAndroidPushConfigured(): boolean {
  const androidConfig = Constants.expoConfig?.android as { googleServicesFile?: string } | undefined;
  return typeof androidConfig?.googleServicesFile === 'string' && androidConfig.googleServicesFile.length > 0;
}

/**
 * Request push permission and register the Expo push token with the server.
 * Silently swallows all errors — push is non-critical.
 *
 * Exported (Round 14) so the «Уведомления» diagnostics block can re-run the
 * whole flow on demand: it is the one button that actually FIXES a device whose
 * registration failed at login (permission granted later, network was down,
 * token rotated after a restore).
 */
export async function registerPushToken(): Promise<void> {
  const lease = captureAuthSession();
  if (!lease.token) return;
  try {
    if (Platform.OS === 'android') {
      // The local notification channel is FCM-independent and cheap — keep it
      // so any displayed notification keeps its importance settings.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
      if (!isAndroidPushConfigured()) {
        // Breadcrumb, not an early-return with no trace: this is a CONFIG gap
        // (no Firebase project yet), not a runtime error. It sticks to the next
        // real event so "Android никогда не получал пуш" is explainable.
        addSentryBreadcrumb({
          category: 'push',
          message: 'android push skipped — googleServicesFile not configured',
          level: 'info',
        });
        return;
      }
    }
    if (!lease.isCurrent()) return;
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (!lease.isCurrent()) return;
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (!lease.isCurrent()) return;
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    // The EAS projectId comes from app.json → extra.eas.projectId — the one
    // and only source of truth. NEVER hardcode it here: a stale hardcoded id
    // (from a deleted EAS project) silently produces tokens Expo can't
    // deliver to, which is exactly the bug this read replaced.
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] EAS projectId missing from expo config — skipping push registration');
      return;
    }
    // Регистрация живёт дольше сессии, и это надо проверять.
    //
    // Функция запускается «выстрелил и забыл» из prefetchAfterLogin, а внутри —
    // диалог разрешений (человек может думать сколько угодно) и лестница
    // ретраев к Expo почти на 35 секунд. За это время сессия успевает
    // кончиться: человек вышел, токен протух, сняли доступ. Раньше мы этого не
    // замечали и всё равно стреляли POST /api/push/token — уже без сессии.
    // Прилетал 401, и он уходил в Sentry как ошибка приложения: 71 событие,
    // которые три с половиной месяца маскировали настоящую историю с
    // разлогинами. Проверяем перед каждым дорогим шагом.
    if (!lease.isCurrent()) return;
    // Transient-ретрай вокруг ОДНОГО шага — похода к Expo push service за
    // токеном. Не-transient ошибки (APNs entitlement, projectId mismatch)
    // пробрасываются с первой попытки и уходят в catch как раньше.
    let tokenData: Notifications.ExpoPushToken | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        break;
      } catch (err) {
        if (!isTransientPushError(err) || attempt >= PUSH_TOKEN_RETRY_DELAYS_MS.length) throw err;
        await sleep(PUSH_TOKEN_RETRY_DELAYS_MS[attempt]);
        if (!lease.isCurrent()) return;
      }
    }
    if (!lease.isCurrent()) return;
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await pushLifecycle.register(lease.token, tokenData.data, platform, lease.isCurrent);
  } catch (err) {
    if (isTransientPushError(err)) {
      // Сеть/Expo-5xx после всех ретраев — это НЕ клиентский баг и не событие
      // для Sentry (шумело issue'ом на каждом офлайн-логине). Крошка остаётся:
      // прилипнет к следующему реальному событию для контекста.
      console.warn('[push] token fetch failed after retries (transient)', err);
      addSentryBreadcrumb({
        category: 'push',
        message: 'push token fetch failed after retries (transient)',
        level: 'warning',
        data: { code: (err as { code?: string } | null)?.code },
      });
      return;
    }
    // 401 здесь — не ошибка приложения, а «пока мы возились, сессия кончилась».
    // Проверки isSessionCleared выше ловят подавляющее большинство случаев, но
    // остаётся щель: сессия могла умереть уже ПОСЛЕ последней проверки, пока
    // POST был в полёте. Такой исход — крошка, а не событие: именно из-за него
    // в Sentry накопился 71 ложный AxiosError.
    if (isAuthExpiry(err)) {
      console.warn('[push] token registration skipped — сессия кончилась');
      addSentryBreadcrumb({
        category: 'push',
        message: 'push token registration skipped — session ended mid-flight',
        level: 'info',
      });
      return;
    }
    // Push registration is best-effort and must never block login, but a
    // SILENT failure (missing APNs entitlement, denied permission, projectId
    // mismatch) leaves NO push_tokens row and makes "push never arrived"
    // impossible to diagnose. Surface it: console warning + Sentry breadcrumb.
    console.warn('[push] token registration failed', err);
    captureException(err, { context: 'registerPushToken' });
  }
}

export function AuthProvider({ children, queryClient, onAuthResolve }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => (queryClient ? attachSessionMutationBoundary(queryClient) : undefined), [queryClient]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const [sessionRecoveryPending, setSessionRecoveryPending] = useState(false);
  // Причина принудительного разлогина (163): «филиал больше не доступен».
  // Живёт до показа на экране входа и гасится там же.
  const [sessionEndedNotice, setSessionEndedNotice] = useState<string | null>(null);
  const sessionRuntimeRef = useRef<SessionEpochRuntime | null>(null);
  if (!sessionRuntimeRef.current) sessionRuntimeRef.current = createSessionEpochRuntime();
  const sessionRuntime = sessionRuntimeRef.current;
  const [registry, setRegistry] = useState<AccountRegistry<User> | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const activeRegistryRef = useRef<{ id: string | null; generation: number }>({ id: null, generation: 0 });
  const loginAttemptRef = useRef(0);
  const installingRef = useRef(false);
  type PendingLogin = {
    handle: AccountLoginHandle;
    selectToken: string;
    expiresAt: number;
    generation: number;
    isCurrent: () => boolean;
    options: AccountLoginOptions;
  };
  const loginHandles = useRef(new Map<AccountLoginHandle, PendingLogin>());
  useEffect(() => authAccounts.subscribe(() => setRegistry(authAccounts.snapshot())), []);
  const persistCurrentSession = useCallback(
    async (
      session: { token: string; user: User | null; impersonating: boolean },
      epoch: number,
      generation: number,
    ) => {
      if (!sessionRuntime.isCurrent(epoch)) return;
      await authAccounts.update(session, generation, () => sessionRuntime.isCurrent(epoch));
    },
    [sessionRuntime],
  );
  const recoveryAttemptRef = useRef<Promise<void> | null>(null);
  const foregroundProfileRefreshRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  const foregroundProfileInputsRef = useRef<{
    loading: boolean;
    token: string | null;
    user: User | null;
    refreshUser: () => Promise<void>;
  } | null>(null);
  const recoveryWakeQueuedRef = useRef(false);
  const recoveryForceQueuedRef = useRef(false);
  const recoveryBackoffRef = useRef(createSessionRecoveryBackoff(SESSION_RECOVERY_BACKOFF_MS));
  const recoveryCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Network requests run outside the serial commit queue. Starting a newer
  // transition advances the epoch immediately and aborts tracked bootstrap /
  // recovery reads; a late login response can then only resolve to a no-op.
  const beginSessionTransition = useCallback(() => {
    recoveryWakeQueuedRef.current = false;
    recoveryForceQueuedRef.current = false;
    recoveryBackoffRef.current.reset();
    if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
    recoveryCooldownTimerRef.current = null;
    setSessionRecoveryPending(false);
    return sessionRuntime.begin();
  }, [sessionRuntime]);

  useEffect(
    () => () => {
      if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
      // Abort tracked bootstrap/recovery work and invalidate every late commit
      // before this provider's setters disappear.
      sessionRuntime.begin();
    },
    [sessionRuntime],
  );

  // Load token + cached user on mount (optimistic restore + status-aware
  // background revalidation).
  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let budgetExpired = false;
    const bootstrapEpoch = sessionRuntime.capture();
    const bootstrapAbort = new AbortController();
    const untrackBootstrapAbort = sessionRuntime.trackAbort(bootstrapEpoch, bootstrapAbort);
    // `finish` flips the splash exactly once. With optimistic restore it
    // fires as soon as token+user are read from disk — the shell renders
    // from cache with NO network wait; /me revalidates in the background.
    const finish = () => {
      if (resolved || cancelled) return;
      resolved = true;
      setLoading(false);
      onAuthResolve?.();
    };

    // This timer starts before AsyncStorage, so the budget covers the WHOLE
    // bootstrap rather than only the HTTP portion. On expiry we cancel the
    // single /me request (including any remaining axios ring traversal) and
    // release the splash. Cancellation is a transient outcome: it must never
    // clear a stored token or an optimistically restored user.
    const deadlineTimer = setTimeout(() => {
      budgetExpired = true;
      bootstrapAbort.abort();
      finish();
    }, AUTH_BOOTSTRAP_BUDGET_MS);

    (async () => {
      // Secure registry is authoritative; legacy credentials are migrated once.
      const storedSession = await readStoredAccountSession();
      const restoredRegistry = authAccounts.snapshot();
      const bootstrapRegistryGeneration = restoredRegistry?.generation ?? 0;
      const stored = storedSession.token;
      const cachedUser = storedSession.user;
      // A native storage bridge can itself stall. Never let a value captured
      // before the deadline overwrite a login/session established after the
      // splash was released.
      if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
      // Restore the impersonation banner state for the (short) life of the
      // director token. If the token has already expired, the /me below 401s
      // and the whole session — flag included — is wiped.
      activeRegistryRef.current = { id: restoredRegistry?.activeId ?? null, generation: bootstrapRegistryGeneration };
      if (storedSession.impersonating) setIsImpersonating(true);

      if (!stored) {
        // No token → logged out. Drop any stray cached user (tenant safety)
        // and the impersonation flag (it must never outlive its token).
        setRecoveringSession(false);
        setIsImpersonating(false);
        clearTimeout(deadlineTimer);
        finish();
        return;
      }

      // Prime the axios in-memory token cache so the very first wave of
      // post-mount requests (the `me()` below + any eager screen queries)
      // skip the per-request AsyncStorage bridge read.
      void resetLiveActivitySession();
      setAuthToken(stored, true);
      setToken(stored);
      const scope = cachedUser ? userDataOwner(cachedUser) : null;
      setDataSession(scope);
      setSessionGeneration((value) => value + 1);
      setPersistentCacheSession(scope);
      if (cachedUser) void adoptTenantStorage(queueOwnerOf(cachedUser)).catch(() => {});

      // Optimistic restore: if we also have a cached user, render the shell
      // immediately from cache. This kills the "flash of Login" on cold
      // start — the user sees their app instantly while /me revalidates.
      if (cachedUser) {
        setUser(cachedUser);
        setRecoveringSession(false);
        finish();
      } else {
        // We know the bearer exists, but cannot safely enter the app until
        // /me identifies its tenant/user. If the first attempt times out the
        // navigator shows an explicit recovery surface, never a fake Login.
        setRecoveringSession(true);
      }

      // Background (or blocking, when no cached user) revalidation. This is
      // intentionally ONE request: axios owns traversal of the three-host
      // ring, while the AbortSignal enforces the single cold-start deadline.
      try {
        const res = await api.get<User>('/auth/me', { signal: bootstrapAbort.signal });
        const fresh = res.data;
        // The deadline and epoch are checked AFTER resolution as well: abort
        // is cooperative, so a response already queued on the JS microtask
        // queue may still win the transport race unless we reject it here.
        if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
        let applied = false;
        await sessionRuntime.commit(bootstrapEpoch, async (isCurrent) => {
          if (!isCurrent() || budgetExpired) return;
          const initializeOwner = !cachedUser || !userDataOwner(cachedUser);
          if (initializeOwner) {
            const scope = userDataOwner(fresh);
            setDataSession(scope);
            setPersistentCacheSession(scope);
            setSessionGeneration((value) => value + 1);
          }
          setUser(fresh);
          setRecoveringSession(false);
          applied = true;
          await persistCurrentSession(
            { token: stored, user: fresh, impersonating: storedSession.impersonating },
            bootstrapEpoch,
            bootstrapRegistryGeneration,
          );
          if (isCurrent() && initializeOwner) await adoptTenantStorage(queueOwnerOf(fresh));
        });
        // Token still valid — kick off prefetch for a warm session.
        if (applied && !budgetExpired && sessionRuntime.isCurrent(bootstrapEpoch) && queryClient) {
          prefetchAfterLogin(queryClient, fresh);
        }
        // Тихое продление сессии: /auth/me подтвердил, что bearer жив; если
        // ему больше SESSION_REFRESH_AGE_MS — fire-and-forget обмен на свежий
        // токен. ГЕЙТ: impersonation-сессию (30-мин директорский токен)
        // продлевать нельзя. Результат применяется СТРОГО через
        // sessionRuntime.commit с ЭТИМ же bootstrapEpoch — тот же серийный
        // путь, что и запись /auth/me выше: любой более новый login/logout
        // продвигает эпоху, isCurrent() становится false и поздний refresh
        // токена A не может перезаписать токен B (класс багов, от которого
        // построен epoch-механизм). axios.ts не трогаем: refresh — обычный
        // авторизованный POST на текущем bearer'е.
        if (applied && !budgetExpired && sessionRuntime.isCurrent(bootstrapEpoch) && !storedSession.impersonating) {
          const issuedAt = jwtIssuedAtMs(stored);
          if (issuedAt !== null && Date.now() - issuedAt > SESSION_REFRESH_AGE_MS) {
            void (async () => {
              try {
                const newToken = await refreshSessionToken();
                if (!newToken) return;
                await sessionRuntime.commit(bootstrapEpoch, async (isCurrent) => {
                  if (!isCurrent()) return;
                  await persistCurrentSession(
                    { token: newToken, user: fresh, impersonating: storedSession.impersonating },
                    bootstrapEpoch,
                    bootstrapRegistryGeneration,
                  );
                  if (!isCurrent()) return;
                  setAuthToken(newToken);
                  setToken(newToken);
                });
              } catch {
                // Сюда доходит только сбой записи сессии: сам обмен свои
                // транспортные отказы уже отретраил и на любом исходе вернул
                // токен либо null. И честно: «не продлили» НЕ означает «старый
                // токен ещё жив» — сервер гасит его раньше, чем выдаёт новый,
                // поэтому при потерянном ответе сессия доживает лишь остаток
                // grace-окна. Это цена одноразового обмена, ради неё выше и
                // стоят ретраи.
              }
            })();
          }
        }
      } catch (err) {
        if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
        if (isAuthExpiry(err)) {
          // Genuine expiry (401) — clear token + cached user and fall back to
          // Login. A valid token is only ever wiped on a REAL 401. This also
          // covers an expired impersonation (30-min director) token: the
          // banner flag is cleared and the superadmin lands on Login.
          setAuthToken(null);
          void authAccounts
            .deactivate(activeRegistryRef.current.id, () => sessionRuntime.isCurrent(bootstrapEpoch))
            .catch(() => {});
          setDataSession(null);
          setPersistentCacheSession(null);
          void endOfflineCheckQueueSession();
          setToken(null);
          setUser(null);
          setRecoveringSession(false);
          setIsImpersonating(false);
        }
        // Non-401 (network / timeout / 5xx, or `!err.response`): DO NOTHING.
        // Keep the optimistically-restored cached session — a transient
        // failure must never log a user out. The token survives untouched.
      } finally {
        clearTimeout(deadlineTimer);
        untrackBootstrapAbort();
        // No-op if we already finished optimistically; otherwise (no cached
        // user) this is where the splash finally dismisses.
        finish();
      }
    })().catch(() => {
      if (!cancelled && sessionRuntime.isCurrent(bootstrapEpoch)) {
        setSessionEndedNotice(
          'Не удалось прочитать защищённое хранилище. Повторите вход после восстановления доступа.',
        );
        finish();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(deadlineTimer);
      bootstrapAbort.abort();
      untrackBootstrapAbort();
    };
    // onAuthResolve is captured intentionally — we only fire it for the
    // initial mount cycle, not on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const attemptSessionRecovery = useCallback(
    (force = false) => {
      if (loading || !recoveringSession || !token || user) return;
      if (recoveryAttemptRef.current) {
        recoveryWakeQueuedRef.current = true;
        if (force) recoveryForceQueuedRef.current = true;
        return;
      }
      const cooldownRemaining = recoveryBackoffRef.current.remainingMs();
      if (!force && cooldownRemaining > 0) {
        if (!recoveryCooldownTimerRef.current) {
          recoveryCooldownTimerRef.current = setTimeout(() => {
            recoveryCooldownTimerRef.current = null;
            attemptSessionRecovery(false);
          }, cooldownRemaining);
        }
        return;
      }
      if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
      recoveryCooldownTimerRef.current = null;

      const recoveryEpoch = sessionRuntime.capture();
      const recoveryRegistryGeneration = activeRegistryRef.current.generation;
      const recoveryAbort = new AbortController();
      const untrackRecoveryAbort = sessionRuntime.trackAbort(recoveryEpoch, recoveryAbort);
      let budgetExpired = false;
      let recovered = false;
      recoveryWakeQueuedRef.current = false;
      recoveryForceQueuedRef.current = false;
      setSessionRecoveryPending(true);

      const work = (async () => {
        const deadlineTimer = setTimeout(() => {
          budgetExpired = true;
          recoveryAbort.abort();
        }, SESSION_RECOVERY_BUDGET_MS);
        try {
          const res = await runSessionRecoveryAttempt({
            forceFreshRoute: force,
            reselectRoute: reselectApiHost,
            isCurrent: () => !budgetExpired && sessionRuntime.isCurrent(recoveryEpoch),
            loadUser: () =>
              api.get<User>('/auth/me', {
                signal: recoveryAbort.signal,
                timeout: SESSION_RECOVERY_HOST_TIMEOUT_MS,
              }),
          });
          if (!res) return;
          const fresh = res.data;
          if (budgetExpired || !sessionRuntime.isCurrent(recoveryEpoch)) return;

          let applied = false;
          await sessionRuntime.commit(recoveryEpoch, async (isCurrent) => {
            if (!isCurrent() || budgetExpired) return;
            const scope = userDataOwner(fresh);
            setDataSession(scope);
            setPersistentCacheSession(scope);
            setSessionGeneration((value) => value + 1);
            setUser(fresh);
            setRecoveringSession(false);
            applied = true;
            recovered = true;
            recoveryBackoffRef.current.reset();
            await persistCurrentSession(
              { token, user: fresh, impersonating: isImpersonating },
              recoveryEpoch,
              recoveryRegistryGeneration,
            );
            if (isCurrent()) await adoptTenantStorage(queueOwnerOf(fresh));
          });
          if (applied && !budgetExpired && sessionRuntime.isCurrent(recoveryEpoch) && queryClient) {
            prefetchAfterLogin(queryClient, fresh);
          }
        } catch {
          // 401 is handled by the axios auth-expiry event. Transport/timeout/5xx
          // deliberately leave the bearer and recovery surface intact for the
          // next route-success, foreground or explicit user retry.
        } finally {
          clearTimeout(deadlineTimer);
          untrackRecoveryAbort();
          // A second recovery cannot start while this ref is non-null; clear it
          // unconditionally before consuming a queued positive network signal.
          recoveryAttemptRef.current = null;
          const stillCurrent = sessionRuntime.isCurrent(recoveryEpoch);
          if (stillCurrent) setSessionRecoveryPending(false);
          if (!recovered && stillCurrent) {
            recoveryBackoffRef.current.recordFailure();
          }
          const retryQueued = recoveryWakeQueuedRef.current;
          const retryForce = recoveryForceQueuedRef.current;
          recoveryWakeQueuedRef.current = false;
          recoveryForceQueuedRef.current = false;
          if (retryQueued && !recovered && stillCurrent) {
            queueMicrotask(() => attemptSessionRecovery(retryForce));
          }
        }
      })();
      recoveryAttemptRef.current = work;
    },
    [isImpersonating, loading, queryClient, recoveringSession, sessionRuntime, token, user],
  );

  const retrySessionRecovery = useCallback(() => attemptSessionRecovery(true), [attemptSessionRecovery]);

  // Wake the unresolved stored session only on positive evidence: an axios
  // request succeeded, or App's existing NetInfo/AppState route controller
  // completed a healthy reselection. No second selector/listener is created.
  useEffect(() => {
    if (loading || !recoveringSession || !token || user) return;
    const retry = () => attemptSessionRecovery(false);
    const unsubscribeRoute = onApiRouteReady(retry);
    const unsubscribeRequest = onRequestSucceeded(retry);
    return () => {
      unsubscribeRoute();
      unsubscribeRequest();
    };
  }, [attemptSessionRecovery, loading, recoveringSession, token, user]);

  // Listen for 401 events from axios interceptor
  useEffect(() => {
    return onAuthExpired((reason) => {
      const expiredEpoch = beginSessionTransition();
      void pushLifecycle.detach().catch(() => {});
      void resetLiveActivitySession();
      // Причину ставим ДО гашения сессии: экран входа отрисуется тем же
      // кадром, что и разлогин, и должен уже знать, что сказать человеку.
      setSessionEndedNotice(reason ?? null);
      // Publish the logout boundary before any unbounded query cancellation.
      // These calls start synchronously: even if the runtime queue is wedged,
      // a killed process cannot reboot into the expired bearer plus live A
      // queue/cache. A newer login is protected by each storage generation.
      setAuthToken(null);
      setToken(null);
      setUser(null);
      setRecoveringSession(false);
      setSessionRecoveryPending(false);
      setIsImpersonating(false);
      setDataSession(null);
      setSessionGeneration((value) => value + 1);
      const tombstoneWrite = authAccounts
        .deactivate(activeRegistryRef.current.id, () => sessionRuntime.isCurrent(expiredEpoch))
        .catch(() => {});
      // ОЧЕРЕДЬ ЧЕКОВ ПЕРЕЖИВАЕТ ИСТЁКШИЙ ТОКЕН. Сама очередь трактует 401 как
      // ВРЕМЕННУЮ ошибку (isPermanentServerRejection) и рассчитана дослать чек
      // после повторного входа — а здесь она стиралась безусловно, и три
      // набитых в офлайне заказ-наряда исчезали молча. Особенно больно после
      // волны филиалов: снятие доступа к филиалу и его архивация выкидывают
      // мастера посреди смены тем же 401. Диск остаётся за владельцем очереди;
      // другие сохранённые аккаунты получают отдельные пространства на диске.
      const tenantDiskClear = endTenantStorage().catch(() => {});

      void sessionRuntime.commit(expiredEpoch, async (isCurrent) => {
        if (!isCurrent()) return;
        await tombstoneWrite;
        if (!isCurrent()) return;
        await queryClient?.cancelQueries().catch(() => {});
        if (!isCurrent()) return;
        queryClient?.clear();
        clearWidgetData();
        await tenantDiskClear;
      });
    });
  }, [beginSessionTransition, queryClient, sessionRuntime]);

  // Stabilise the auth API surface — every consumer of `useAuth()` reads
  // these callbacks, and a fresh function identity on every AuthProvider
  // render would invalidate any `useMemo`/`useCallback` depending on
  // them downstream. Wrapping in `useCallback` keeps the identities
  // stable across renders, so re-renders only fire on actual auth-state
  // change (login, logout, 401, refreshUser).
  /** Commit one logical active session after secure readback. All volatile
   * leases change synchronously before a new bearer can dispatch work. */
  const applyRegistrySession = useCallback(
    async (saved: AccountRegistry<User>) => {
      const epoch = beginSessionTransition();
      void pushLifecycle.detach().catch(() => {});
      loginAttemptRef.current += 1;
      loginHandles.current.clear();
      const next = activeAccount(saved)?.session;
      activeRegistryRef.current = { id: saved.activeId, generation: saved.generation };
      queryClient?.cancelQueries().catch(() => {});
      queryClient?.clear();
      clearWidgetData();
      void resetLiveActivitySession();
      void endTenantStorage().catch(() => {});
      const scope = next?.user ? userDataOwner(next.user) : null;
      setDataSession(scope);
      setPersistentCacheSession(scope);
      setAuthToken(next?.token ?? null, true);
      setToken(next?.token ?? null);
      setUser(next?.user ?? null);
      setSessionGeneration((value) => value + 1);
      setRecoveringSession(!!next?.token && !next.user);
      setSessionRecoveryPending(false);
      setIsImpersonating(next?.impersonating ?? false);
      setSessionEndedNotice(null);
      setRegistry(saved);
      if (next?.user) {
        await adoptTenantStorage(queueOwnerOf(next.user)).catch(() => {});
        if (sessionRuntime.isCurrent(epoch) && queryClient) prefetchAfterLogin(queryClient, next.user);
      }
    },
    [beginSessionTransition, queryClient, sessionRuntime],
  );

  const commitSession = useCallback(
    async (
      t: string,
      u: User,
      plan: {
        generation: number;
        isCurrent: () => boolean;
        originalAccountId?: string;
        reauthAccountId?: string;
        impersonating?: boolean;
      },
    ) => {
      if (!plan.isCurrent() || installingRef.current)
        throw new AccountRegistryError('SESSION_CHANGED', 'Другой вход уже выполняется.');
      installingRef.current = true;
      try {
        const saved = await authAccounts.install(
          { token: t, user: u, impersonating: !!plan.impersonating },
          plan.generation,
          plan,
        );
        // An explicit logout may overtake a native write. Its queued deactivate
        // owns the final durable state, and this older install cannot revive UI.
        if (!plan.isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась во время входа.');
        await applyRegistrySession(saved.registry);
      } finally {
        installingRef.current = false;
      }
    },
    [applyRegistrySession],
  );

  const addAccount = useCallback(
    async (phone: string, password: string, options: AccountLoginOptions = {}): Promise<LoginStepResult> => {
      if (installingRef.current) throw new AccountRegistryError('SESSION_CHANGED', 'Дождитесь завершения входа.');
      const attempt = ++loginAttemptRef.current;
      loginHandles.current.clear();
      const epoch = sessionRuntime.capture();
      const isCurrent = () => attempt === loginAttemptRef.current && sessionRuntime.isCurrent(epoch);
      const saved = await authAccounts.read();
      if (!isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Попытка входа отменена.');
      const res = await authApi.loginWithPointSelect({ phone, password });
      if (!isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Попытка входа отменена.');
      const data = res.data;
      if ('pointSelectionRequired' in data) {
        const handle = Object.freeze({ id: attempt });
        const expiresAt = Date.now() + data.expiresIn * 1000;
        loginHandles.current.set(handle, {
          handle,
          selectToken: data.selectToken,
          expiresAt,
          generation: saved.generation,
          isCurrent,
          options: { ...options },
        });
        return {
          status: 'point-required',
          operation: handle,
          selectToken: data.selectToken,
          expiresAt,
          points: data.points,
          defaultPointId: data.defaultPointId,
        };
      }
      await commitSession(data.token, data.user, { generation: saved.generation, isCurrent, ...options });
      return { status: 'authenticated' };
    },
    [commitSession, sessionRuntime],
  );
  const completeAccountLogin = useCallback(
    async (handle: AccountLoginHandle, pointId: string) => {
      const pending = loginHandles.current.get(handle);
      if (!pending || !pending.isCurrent() || pending.expiresAt <= Date.now())
        throw new AccountRegistryError('SESSION_CHANGED', 'Выбор филиала истёк. Повторите вход.');
      // One exchange per operation; a lost response requires a fresh login, never
      // a second exchange of a one-use select token.
      loginHandles.current.delete(handle);
      const res = await authApi.selectPoint({ selectToken: pending.selectToken, pointId });
      if (!pending.isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Попытка входа отменена.');
      await commitSession(res.data.token, res.data.user, {
        generation: pending.generation,
        isCurrent: pending.isCurrent,
        ...pending.options,
      });
    },
    [commitSession],
  );
  const cancelAccountLogin = useCallback((handle: AccountLoginHandle) => {
    if (installingRef.current) return;
    if (handle.id === loginAttemptRef.current) loginAttemptRef.current += 1;
    loginHandles.current.delete(handle);
  }, []);
  const login = useCallback((phone: string, password: string) => addAccount(phone, password), [addAccount]);
  const loginWithPoint = useCallback(
    async (selectToken: string, pointId: string) => {
      const pending = [...loginHandles.current.values()].find((p) => p.selectToken === selectToken);
      if (!pending) throw new AccountRegistryError('SESSION_CHANGED', 'Попытка входа отменена.');
      await completeAccountLogin(pending.handle, pointId);
    },
    [completeAccountLogin],
  );
  const switchAccount = useCallback(
    async (id: string) => {
      if (installingRef.current) throw new AccountRegistryError('SESSION_CHANGED', 'Дождитесь завершения входа.');
      const source = sessionRuntime.capture();
      const saved = await authAccounts.read();
      if (!sessionRuntime.isCurrent(source)) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
      installingRef.current = true;
      try {
        const next = await authAccounts.activate(id, saved.generation, () => sessionRuntime.isCurrent(source));
        if (!sessionRuntime.isCurrent(source)) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
        if (!next.result) {
          if (saved.activeId === id) await applyRegistrySession(next.registry);
          throw new AccountRegistryError('REAUTH_REQUIRED', 'Войдите в этот аккаунт снова.');
        }
        await applyRegistrySession(next.registry);
      } finally {
        installingRef.current = false;
      }
    },
    [applyRegistrySession, sessionRuntime],
  );

  const inspectAccountRemoval = useCallback(
    async (id: string) => {
      const source = sessionRuntime.capture();
      const saved = await authAccounts.read();
      const account = saved.accounts.find((item) => item.id === id);
      if (!account || !sessionRuntime.isCurrent(source))
        throw new AccountRegistryError('SESSION_CHANGED', 'Аккаунт уже удалён.');
      const result = await inspectSavedAccountRemoval(AsyncStorage, account);
      if (!sessionRuntime.isCurrent(source)) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
      return result;
    },
    [sessionRuntime],
  );
  const removeAccount = useCallback(
    async (id: string) => {
      if (installingRef.current) throw new AccountRegistryError('SESSION_CHANGED', 'Дождитесь завершения входа.');
      const source = sessionRuntime.capture();
      const isCurrent = () => sessionRuntime.isCurrent(source);
      installingRef.current = true;
      try {
        const saved = await authAccounts.read();
        const account = saved.accounts.find((item) => item.id === id);
        if (!account || !isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Аккаунт изменился.');
        const inspection = await inspectSavedAccountRemoval(AsyncStorage, account);
        if (!inspection.canRemove)
          throw new AccountRegistryError(
            'UNRESOLVED_INTENTS',
            'В аккаунте остались неотправленные или неподтверждённые операции. Завершите их перед удалением.',
          );
        if (!isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
        const next = await authAccounts.remove(id, saved.generation, isCurrent);
        if (!isCurrent()) throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
        // No financial, NFC or queue ledger is ever deleted, including a request
        // that was persisted concurrently with this final inspection.
        const otherScopes = new Set(
          next.registry.accounts.flatMap((item) => item.scopes.map((scope) => JSON.stringify(scope))),
        );
        const scopes = account.scopes.filter((scope) => !otherScopes.has(JSON.stringify(scope)));
        if (account.session) void pushLifecycle.logout(account.session.token, saved.activeId === id).catch(() => {});
        if (saved.activeId === id) await applyRegistrySession(next.registry);
        else activeRegistryRef.current.generation = next.registry.generation;
        const cleanupEpoch = sessionRuntime.capture();
        await clearAccountCaches(scopes, () => sessionRuntime.isCurrent(cleanupEpoch));
      } finally {
        installingRef.current = false;
      }
    },
    [applyRegistrySession, sessionRuntime],
  );

  /** Server-authorized point reissue retains the original account slot.
   * Old-point queues/cache stay in their exact namespace and never replay
   * with the replacement bearer. The reissue window preserves existing 401
   * handling while the old JWT is being exchanged. */
  const renderEpoch = sessionRuntime.capture();
  const sessionClient = useMemo(() => createSessionBoundClient(token), [token, sessionGeneration]);
  const switchSessionPoint = useCallback(
    async (pointId: string) => {
      if (installingRef.current || !sessionRuntime.isCurrent(renderEpoch))
        throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
      const saved = authAccounts.snapshot();
      if (!saved?.activeId) throw new AccountRegistryError('SESSION_CHANGED', 'Нет активного аккаунта.');
      const previousPointId = user?.currentPointId ?? null;
      if (previousPointId) {
        try {
          await stampOfflineCheckQueuePoint(previousPointId);
        } catch {
          // Диск отказал — переключение важнее штампа: человек уже прочитал в
          // диалоге, что лежит на телефоне, а сервер при досылке подставит
          // филиал сам, ровно как до 167.
        }
      }
      // Окно перевыпуска держим ОТ запроса ДО применения нового токена: в этой
      // щели старый bearer уже мёртв на сервере, и чужие запросы, улетевшие с
      // ним, вернут 401 «Токен отозван». Гасить из-за них живую сессию нельзя —
      // см. beginSessionReissueWindow в api/axios.ts.
      if (!sessionRuntime.isCurrent(renderEpoch))
        throw new AccountRegistryError('SESSION_CHANGED', 'Сессия изменилась.');
      const closeReissueWindow = beginSessionReissueWindow();
      try {
        const res = await serviceFactories.createAuthApi(sessionClient).switchSessionPoint(pointId);
        await commitSession(res.data.token, res.data.user, {
          generation: saved.generation,
          originalAccountId: saved.activeId,
          isCurrent: () => sessionRuntime.isCurrent(renderEpoch),
        });
        setOfflineCheckQueuePointId(res.data.currentPointId);
      } finally {
        closeReissueWindow();
      }
    },
    [commitSession, user, sessionClient, renderEpoch, sessionRuntime],
  );

  const refreshUser = useCallback(async () => {
    const refreshEpoch = renderEpoch;
    const refreshRegistryGeneration = activeRegistryRef.current.generation;
    const currentFlight = foregroundProfileRefreshRef.current;
    if (currentFlight?.epoch === refreshEpoch) return currentFlight.promise;
    const flight = { epoch: refreshEpoch, promise: Promise.resolve() };
    const work = (async () => {
      try {
        const res = await serviceFactories.createAuthApi(sessionClient).me();
        const fresh = res.data as User;
        await sessionRuntime.commit(refreshEpoch, async (isCurrent) => {
          if (!isCurrent()) return;
          setUser(fresh);
          if (token)
            await persistCurrentSession(
              { token, user: fresh, impersonating: isImpersonating },
              refreshEpoch,
              refreshRegistryGeneration,
            );
        });
      } catch {
        // A transient failure keeps the cached session; foreground will retry.
      } finally {
        if (foregroundProfileRefreshRef.current === flight) foregroundProfileRefreshRef.current = null;
      }
    })();
    flight.promise = work;
    foregroundProfileRefreshRef.current = flight;
    return work;
  }, [isImpersonating, sessionRuntime, token, renderEpoch, sessionClient, persistCurrentSession]);

  foregroundProfileInputsRef.current = { loading, token, user, refreshUser };

  // Cached profiles are rendered before the single cold-start /auth/me call.
  // If that call fails, retry the current user's own profile on a genuine
  // foreground transition, using the same epoch-guarded refresh path as the
  // explicit profile refresh. A short throttle and shared in-flight promise
  // collapse rapid AppState events without clearing a valid offline cache.
  useEffect(() => {
    const controller = createForegroundProfileRefreshController({
      getEpoch: () => sessionRuntime.capture(),
      canRefresh: () => {
        const current = foregroundProfileInputsRef.current;
        return !!current && !current.loading && !!current.token && !!current.user;
      },
      refresh: () => foregroundProfileInputsRef.current?.refreshUser() ?? Promise.resolve(),
    });
    const subscription = AppState.addEventListener('change', controller.onAppState);
    return () => subscription.remove();
  }, [sessionRuntime]);

  const logout = useCallback(async () => {
    if (!sessionRuntime.isCurrent(renderEpoch)) return;
    const logoutEpoch = beginSessionTransition();
    void resetLiveActivitySession();
    // Queue cleanup before the next owner's registration. A failed cleanup
    // retains its secure claim and does not revoke the only usable credential.
    if (token) void pushLifecycle.logout(token, true).catch(() => {});

    setAuthToken(null);
    setToken(null);
    setUser(null);
    setRecoveringSession(false);
    setSessionRecoveryPending(false);
    setIsImpersonating(false);
    setDataSession(null);
    setSessionGeneration((value) => value + 1);
    const tombstoneWrite = authAccounts
      .deactivate(activeRegistryRef.current.id, () => sessionRuntime.isCurrent(logoutEpoch))
      .catch(() => {});
    // Выход НЕ стирает офлайн-очередь: чеки принадлежат человеку, а не сессии,
    // и он почти всегда входит обратно (смена филиала = выход и новый вход).
    // Предупреждение «есть неотправленные чеки» живёт в UI до вызова logout.
    const tenantDiskClear = endTenantStorage().catch(() => {});

    await sessionRuntime.commit(logoutEpoch, async (isCurrent) => {
      if (!isCurrent()) return;
      await tombstoneWrite;
      if (!isCurrent()) return;
      await queryClient?.cancelQueries().catch(() => {});
      if (!isCurrent()) return;
      queryClient?.clear();
      clearWidgetData();
      await tenantDiskClear;
      if (!isCurrent()) return;
      ExpoImage.clearDiskCache().catch(() => {});
      ExpoImage.clearMemoryCache().catch(() => {});
    });
  }, [beginSessionTransition, queryClient, sessionRuntime, token, renderEpoch]);

  /**
   * beginImpersonation — install the short-lived (30-min) director token
   * returned by `tenantsApi.impersonate(id)` and become that tenant's owner.
   *
   * Mirrors `login()`'s cross-tenant isolation EXACTLY (cancel + clear
   * QueryClient, clear persistent cache, reset the bearer + ETag map, persist
   * the new token + user) so none of the superadmin's cached data bleeds into
   * the impersonated tenant's session. The only departure: we receive the
   * token + user directly (no /auth/login round-trip) and set the
   * impersonation flag so the persistent banner renders. When `user.role`
   * flips to 'director' the root navigator re-renders into the normal
   * car-service tree — no special-casing needed there.
   */
  const beginImpersonation = useCallback(
    async (t: string, u: User) => {
      const saved = authAccounts.snapshot();
      if (!saved?.activeId || !sessionRuntime.isCurrent(renderEpoch))
        throw new AccountRegistryError('SESSION_CHANGED', 'Исходная сессия изменилась.');
      await commitSession(t, u, {
        generation: saved.generation,
        originalAccountId: saved.activeId,
        impersonating: true,
        isCurrent: () => sessionRuntime.isCurrent(renderEpoch),
      });
    },
    [commitSession, renderEpoch, sessionRuntime],
  );

  /**
   * endImpersonation — leave the impersonated session. The director token is
   * short-lived and carries no superadmin credentials to restore, so the only
   * safe exit is a full logout back to Login (the superadmin signs in again).
   * The confirm dialog before impersonating states this explicitly.
   */
  const endImpersonation = useCallback(() => {
    logout();
  }, [logout]);

  const hasPermission = useCallback(
    (perm: keyof UserPermissions): boolean => {
      if (!user) return false;
      if (user.role === 'superadmin' || user.role === 'director') return true;
      return !!user.permissions?.[perm];
    },
    [user],
  );

  const clearSessionEndedNotice = useCallback(() => setSessionEndedNotice(null), []);

  const isRole = useCallback(
    (...roles: UserRole[]): boolean => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  );

  // Memoise the context value so AuthContext.Provider doesn't broadcast a
  // fresh object reference on every AuthProvider render (e.g. when only
  // `loading` flips). With the memo, consumers see a stable value as
  // long as user/token/loading don't actually change.
  const value = useMemo<AuthContextType>(
    () => ({
      inspectAccountRemoval,
      removeAccount,
      savedAccounts: accountSummaries(registry).map((a) => ({
        ...a,
        active: !!token && a.id === activeRegistryRef.current.id,
      })),
      activeAccountId: token ? activeRegistryRef.current.id : null,
      sessionGeneration,
      addAccount,
      completeAccountLogin,
      cancelAccountLogin,
      switchAccount,
      user,
      token,
      loading,
      recoveringSession,
      sessionRecoveryPending,
      retrySessionRecovery,
      login,
      loginWithPoint,
      switchSessionPoint,
      logout,
      refreshUser,
      hasPermission,
      isRole,
      isImpersonating,
      beginImpersonation,
      endImpersonation,
      sessionEndedNotice,
      clearSessionEndedNotice,
    }),
    [
      registry,
      sessionGeneration,
      addAccount,
      completeAccountLogin,
      cancelAccountLogin,
      switchAccount,
      inspectAccountRemoval,
      removeAccount,
      user,
      token,
      loading,
      recoveringSession,
      sessionRecoveryPending,
      retrySessionRecovery,
      login,
      loginWithPoint,
      switchSessionPoint,
      logout,
      refreshUser,
      hasPermission,
      isRole,
      isImpersonating,
      beginImpersonation,
      endImpersonation,
      sessionEndedNotice,
      clearSessionEndedNotice,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      <React.Fragment key={sessionGeneration}>{children}</React.Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
