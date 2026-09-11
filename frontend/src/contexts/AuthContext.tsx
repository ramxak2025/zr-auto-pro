import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import {
  authApi,
  productsApi,
  servicesApi,
  clientsApi,
  carsApi,
  usersApi,
  warehouseCategoriesApi,
  subscriptionApi,
  pointsApi,
} from '../api/services';
import { User, UserPermissions, UserRole } from '../types';
import type { LoginPointOption } from '../../../shared/api/types';
import { clearPersistentCache } from '../utils/persistentCache';
import { clearOwnSessionToken, readStoredToken, writeSessionToken } from '../utils/sessionToken';
import { flushOfflineQueue, purgeApiCache, purgeOfflineQueues, readOfflineQueueState } from '../utils/swCache';
import { judgeQueueFlush, OfflineQueueBlockedError } from '../utils/offlineQueueSwitch';
import { forgetSessionEndedNotice, peekSessionEndedNotice } from '../utils/sessionNotice';

/**
 * Warm the React Query cache with data the user is likely to open next.
 *
 * Runs in the background after login / session restore. Failures are silent —
 * this is a perf optimization, not a contract. Screens still fetch their own
 * data via useQuery if prefetch lost the race.
 *
 * Mirrors `prefetchAfterLogin` in `mobile/src/contexts/AuthContext.tsx` so
 * web and mobile feel equally fast on first navigation.
 *
 * ROLE HYGIENE (matches mobile's prod-incident fix 2026-06): this fan-out used
 * to fire owner-scoped requests (`/users`, `/clients`, `/suppliers`, …) for
 * EVERY role on every refresh. A master can't read those — the backend answers
 * 401/403 — and the resulting boot 401 was nuking an otherwise-valid session
 * on every refresh. Each prefetch below is now gated by the SAME permission
 * rules the screens use (`hasPermission`), so a master fires ZERO requests it
 * isn't allowed to make.
 */
function prefetchAfterLogin(qc: QueryClient, user: User): void {
  // Mirror of AuthContext.hasPermission: director & superadmin implicitly hold
  // every permission; admin/master fall back to the explicit permissions map.
  const can = (perm: keyof UserPermissions): boolean =>
    user.role === UserRole.SUPERADMIN || user.role === UserRole.DIRECTOR || !!user.permissions?.[perm];

  const limit = 50;
  type PrefetchPair = [unknown[], () => Promise<unknown>];
  const pairs: PrefetchPair[] = [];

  // Warehouse / products — gated by warehouse_access (masters that work the
  // cash screen typically have it; those that don't have no products screen).
  if (can('warehouse_access')) {
    pairs.push([
      ['products', { page: 1, limit, search: '' }],
      () => productsApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ]);
    pairs.push([
      ['warehouse-categories'],
      () => warehouseCategoriesApi.getAll().then((r: { data: unknown }) => r.data),
    ]);
  }

  // Services are read by the cash screen for everyone who can touch checks.
  if (can('checks_view') || can('checks_create')) {
    pairs.push([
      ['services', { page: 1, limit, search: '' }],
      () => servicesApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ]);
  }

  // Clients + cars — gated by clients_view (the Clients screen's own gate).
  if (can('clients_view')) {
    pairs.push([
      ['clients', { search: '', page: 1, limit: 20 }],
      () => clientsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ]);
    pairs.push([
      ['cars', { search: '', page: 1, limit: 20 }],
      () => carsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ]);
  }

  // Users list — owner-side only (user_management). A master never reads it.
  if (can('user_management')) {
    pairs.push([['users'], () => usersApi.getAll().then((r: { data: unknown }) => r.data)]);
  }

  // Subscription is read by Layout for every authenticated role.
  pairs.push([['subscription'], () => subscriptionApi.get().then((r: { data: unknown }) => r.data)]);

  // ФИЛИАЛ СЕССИИ (163) — тот же слот ['points'], что читают индикатор в
  // шапке, раздел «Филиалы» и пикер мастера в кассе. Греем сразу после входа:
  // вход ЧИСТИТ все кеши (иначе после входа в другой филиал мелькнут чужие
  // цифры), поэтому без прогрева первый кадр кассы шёл бы без подписи
  // автосервиса — ровно там, где цена ошибки максимальна. Ответ лёгкий:
  // справочник точек, без денег. Права не требует — ручка отдаёт свои филиалы
  // любому сотруднику тенанта.
  pairs.push([['points'], () => pointsApi.list().then((r: { data: unknown }) => r.data)]);

  for (const [key, fn] of pairs) {
    qc.prefetchQuery({ queryKey: key, queryFn: fn, staleTime: 60_000 }).catch(() => {
      // Silent — prefetch is best-effort.
    });
  }
}

/**
 * ЧТО ОТВЕТИЛ ШАГ 1 ВХОДА (163). Экран входа обязан различать два исхода
 * ОДНОГО нажатия «Войти»:
 *   • `authenticated` — сессия уже установлена (одноточечный автосервис либо
 *     сотруднику доступен ровно один филиал), форма просто исчезает;
 *   • `point-required` — пароль верен, но сессии ещё НЕТ: филиал выбирается
 *     вторым шагом. Токена здесь нет и быть не может — сессия без филиала это
 *     и есть убранный режим «все филиалы».
 */
export type LoginStepResult =
  | { status: 'authenticated' }
  | {
      status: 'point-required';
      /** Одноразовый промежуточный токен; живёт минуты, в обычные ручки не ходит. */
      selectToken: string;
      /** Момент, после которого сервер откажет: считаем из expiresIn при получении. */
      expiresAt: number;
      /** Доступные сотруднику живые филиалы; основной сервис первым (порядок сервера). */
      points: LoginPointOption[];
      /** Где человек работал в прошлый раз — подсветить, но НЕ выбирать за него. */
      defaultPointId: string;
    };

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  /**
   * ШАГ 1 ВХОДА: телефон + пароль. Возвращает, закончился ли вход (сессия
   * установлена) или требуется выбор филиала — см. {@link LoginStepResult}.
   */
  login: (phone: string, password: string) => Promise<LoginStepResult>;
  /**
   * ШАГ 2 ВХОДА: обменять промежуточный токен и выбранный филиал на сессию.
   * Пароль здесь не нужен — он проверен на шаге 1. Бросает ошибку axios как
   * есть: разбор кодов живёт в shared/utils/loginPointSelection.ts (чистая
   * функция), потому что от него зависит, куда вести человека.
   */
  loginWithPoint: (selectToken: string, pointId: string) => Promise<void>;
  /**
   * МГНОВЕННАЯ СМЕНА ФИЛИАЛА РУКОВОДИТЕЛЕМ (167) — без повторного ввода пароля.
   *
   * Зовётся ТОЛЬКО из раздела «Филиалы» (требование владельца) и только у
   * держателя права `user_management`; сотруднику филиал по-прежнему меняется
   * выходом и входом заново — у него филиал определяет, куда уходят его деньги,
   * и случайная смена дороже неудобства.
   *
   * Это не вход без пароля, а ПЕРЕВЫПУСК сессии: личность подтверждена живым
   * токеном, сервер проверяет право и доступ к филиалу, выдаёт новый токен и
   * немедленно гасит прежний. Ошибку axios бросает как есть — разбор кодов
   * живёт в utils/switchPointFailure.ts, потому что от него зависит, оставлять
   * человека в сессии или вести на вход.
   *
   * СНАЧАЛА ОЧЕРЕДЬ, ПОТОМ СЕССИЯ. Если в офлайн-очереди Service Worker лежат
   * неотправленные мутации, они доигрываются ПОД СТАРЫМ ТОКЕНОМ, и филиал
   * меняется только по нулевому остатку. Не доиграли — бросается
   * {@link OfflineQueueBlockedError}, сессия не трогается (см. тело функции).
   */
  switchPoint: (pointId: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
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

// Use null default instead of `{} as AuthContextType` — accessing the context
// outside of AuthProvider would silently return an empty object, causing
// runtime crashes when calling .login(), .logout() etc.
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(readStoredToken());
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Причина принудительного разлогина (163): «Филиал больше не доступен».
  // Её кладёт перехватчик axios ПЕРЕД жёсткой перезагрузкой на /login, поэтому
  // читаем один раз при монтировании провайдера — то есть ровно на том
  // загрузочном кадре, где родился экран входа. Читаем БЕЗ стирания: стирает
  // тот, кто показал (clearSessionEndedNotice на экране входа).
  const [sessionEndedNotice, setSessionEndedNotice] = useState<string | null>(() => peekSessionEndedNotice());

  useEffect(() => {
    if (token) {
      authApi
        .me()
        .then((res: any) => {
          setUser(res.data);
          // Warm reference data immediately after session restore so the
          // first navigation feels instant. Gated by the restored user's role
          // so a master never fires owner-only boot requests.
          prefetchAfterLogin(queryClient, res.data as User);
        })
        .catch((err: any) => {
          // Only clear the token on a genuine auth failure (401/403).
          // Network errors, 5xx, or transient SW offline responses must NOT
          // log the user out — otherwise a 1-second network blip kicks them
          // back to the login screen.
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            clearOwnSessionToken();
            setToken(null);
          } else {
            console.warn('Failed to fetch user (kept session):', status, err?.message);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, queryClient]);

  /**
   * УСТАНОВИТЬ СЕССИЮ по выданному сервером токену — общее тело ОБОИХ шагов
   * входа (163). Один экземпляр, потому что изоляция прошлой сессии здесь не
   * «желательна», а обязательна: вход в ДРУГОЙ филиал обязан стирать кеш так
   * же жёстко, как вход под другим пользователем. Иначе на главной первым
   * кадром мелькнут вчерашние цифры чужого филиала — и это прочитается как
   * «деньги пропали».
   */
  const commitSession = async (t: string, u: User, options?: { keepOfflineQueue?: boolean }) => {
    // Cross-tenant safety: `logout()` is the normal off-boarding path, but a
    // crash / kill / 401 hard-redirect can leave the previous user's data in
    // the in-memory cache, the persist IndexedDB store, or the SW API cache.
    // Start every layer empty BEFORE we write user B's token and prefetch
    // B's data, so A's payloads can never bleed into B's session.
    await queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
    await clearPersistentCache();
    await purgeApiCache();
    // Ту же логику — офлайн-очереди мутаций SW: недоигранные POST'ы прошлой
    // сессии (после краша/убитой вкладки) нельзя переиграть под токеном
    // нового пользователя — это запись в чужой тенант.
    //
    // ИСКЛЮЧЕНИЕ — СМЕНА ФИЛИАЛА (`keepOfflineQueue`). Там ЧЕЛОВЕК И ТЕНАНТ ТЕ
    // ЖЕ, чужого токена не появляется, а очередь уже доиграна до нуля в
    // switchPoint (иначе переключения просто не было бы). Стереть её здесь
    // значило бы уничтожить архив отклонённых записей того же владельца —
    // единственный след пробитых без связи чеков. Вход и выход очередь
    // по-прежнему стирают: за клавиатуру мог сесть другой человек.
    if (!options?.keepOfflineQueue) {
      await purgeOfflineQueues();
    }

    writeSessionToken(t);
    setToken(t);
    setUser(u);
    // Вход состоялся — прошлая причина разлогина больше не актуальна.
    forgetSessionEndedNotice();
    setSessionEndedNotice(null);
    // Prefetch dashboards/lists in the background — by the time the user
    // navigates to /products or /clients, the cache is already warm. Gated by
    // the logged-in user's role (mirrors mobile) so a master never fires
    // owner-only requests that would 401/403 right after login.
    prefetchAfterLogin(queryClient, u);
  };

  /**
   * ШАГ 1 ВХОДА (163). Зовём loginWithPointSelect, а не login: этой сборке
   * ответ со списком филиалов ПОНЯТЕН, и получить вместо него молча
   * подставленный сервером филиал — значит вернуть ровно ту ошибку, из-за
   * которой волна и делалась (человек работает не там, где думает).
   *
   * Сессия здесь создаётся ТОЛЬКО если сервер отдал токен — то есть выбора не
   * было (одноточечный автосервис или ровно один доступный филиал).
   */
  const login = async (phone: string, password: string): Promise<LoginStepResult> => {
    const res = await authApi.loginWithPointSelect({ phone, password });
    const data = res.data;
    if ('pointSelectionRequired' in data) {
      return {
        status: 'point-required',
        selectToken: data.selectToken,
        // Дедлайн считаем от МОМЕНТА ОТВЕТА, а не храним expiresIn: экран
        // должен уметь ответить «уже поздно» без похода в сеть.
        expiresAt: Date.now() + data.expiresIn * 1000,
        points: data.points,
        defaultPointId: data.defaultPointId,
      };
    }
    await commitSession(data.token, data.user);
    return { status: 'authenticated' };
  };

  /** ШАГ 2 ВХОДА (163): выбранный филиал + промежуточный токен → сессия. */
  const loginWithPoint = async (selectToken: string, pointId: string) => {
    const res = await authApi.selectPoint({ selectToken, pointId });
    await commitSession(res.data.token, res.data.user);
  };

  /**
   * МГНОВЕННАЯ СМЕНА ФИЛИАЛА (167). Ровно то же тело, что у обоих шагов входа:
   * сервер выдал токен — применяем его через commitSession.
   *
   * ПОЧЕМУ ИМЕННО commitSession, А НЕ «просто положить токен». Ответ сервера
   * означает, что ПРЕЖНИЙ токен уже мёртв, а всё, что лежит в кешах, посчитано
   * по прежнему филиалу. Любой следующий запрос обязан уйти с новым токеном, а
   * ни одна старая цифра — не пережить переход: касса, журнал, склад и смены
   * отфильтрованы по филиалу сессии, и кадр с чужими деньгами здесь читается
   * как «деньги пропали». Профиль берём из ответа — отдельный /auth/me не нужен.
   */
  const switchPoint = async (pointId: string) => {
    // ── ОФЛАЙН-ОЧЕРЕДЬ ИДЁТ ПЕРЕД СЕССИЕЙ ────────────────────────────────────
    // Недоотправленные мутации лежат в Service Worker (IndexedDB autexa-sw) и
    // не несут Authorization: SW спрашивает токен у живой вкладки в момент
    // досылки. Значит всё, что переживёт переключение, уйдёт уже с токеном
    // НОВОГО филиала — чек, пробитый в «ZR AUTO», запишется в «ТопГаз». А
    // стереть очередь (как делает вход) — потерять эти деньги молча.
    //
    // Поэтому: пока жив токен ТЕКУЩЕГО филиала, дожимаем досылку, и филиал
    // меняется ТОЛЬКО по нулевому остатку. Не доиграли — бросаем
    // OfflineQueueBlockedError, сессия остаётся прежней, экран объясняет
    // человеку, что произошло. Мобилка в той же точке штампует филиал в каждой
    // записи (offlineCheckQueue.stampPendingPoint); в вебе запись — сырой HTTP,
    // штамповать нечем, поэтому правило строже: доиграли или не переключаемся.
    //
    // Проверка стоит ЗДЕСЬ, а не на экране, чтобы её нельзя было обойти,
    // добавив вторую кнопку перехода.
    const queueBefore = await readOfflineQueueState();
    if (queueBefore.pending > 0) {
      const verdict = judgeQueueFlush(queueBefore, await flushOfflineQueue());
      if (!verdict.ok) throw new OfflineQueueBlockedError(verdict);
    }

    const res = await authApi.switchSessionPoint(pointId);
    // keepOfflineQueue: очередь только что доиграна до нуля, а архив отказов
    // принадлежит тому же человеку в том же тенанте — стирать нечего и нельзя.
    await commitSession(res.data.token, res.data.user, { keepOfflineQueue: true });
  };

  const refreshUser = async () => {
    try {
      const res = await authApi.me();
      setUser(res.data);
    } catch (err) {
      console.warn('Failed to refresh user:', err);
    }
  };

  const logout = () => {
    authApi.logout().catch(() => {});

    // ── Cross-tenant isolation ────────────────────────────────────────────
    // On a shared browser/kiosk the next user must not see ANY of this user's
    // data. We tear down every cache layer that could survive a logout:
    //
    //   1. cancelQueries() — abort in-flight refetches so a late response can't
    //      land after teardown and resurrect a stale entry under the next
    //      session (the same fix mobile shipped in commit 0a741a9).
    //   2. queryClient.clear() — drop the in-memory React Query cache.
    //   3. clearPersistentCache() — delete the dehydrated snapshot in the
    //      `@tanstack/react-query-persist-client` IndexedDB store, otherwise it
    //      rehydrates into the next session.
    //   4. purgeApiCache() — drop the service worker's `autexa-api-*` Cache
    //      Storage, which is keyed by URL only (ignores Authorization) and
    //      would otherwise serve tenant A's `/api` payloads to tenant B.
    //   5. purgeOfflineQueues() — drop the SW offline-mutation queue AND the
    //      failed-mutation archive in IndexedDB `autexa-sw`. Queued records
    //      carry no Authorization (SW v14): replay uses the CURRENT session's
    //      token, so a leftover queue would post this user's mutations into
    //      the NEXT user's tenant.
    //
    // Steps 1–2 are synchronous and run before we clear the token, so nothing
    // stale is in memory by the time the redirect to /login fires. Steps 3–5
    // are async best-effort; we run them but don't block the redirect.
    void queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
    void clearPersistentCache();
    void purgeApiCache();
    void purgeOfflineQueues();

    // Стираем ТОЛЬКО свой токен (167): если соседняя вкладка уже перевыпустила
    // сессию (смена филиала), в хранилище лежит ЕЁ живой токен — удалить его
    // значит обесточить человека посреди работы в той вкладке.
    clearOwnSessionToken();
    localStorage.removeItem('user');
    // Обычный выход причины не имеет: если в хранилище осталась чужая (её
    // положил перехватчик, но экран входа так и не открылся), она всплыла бы
    // сейчас и напугала бы человека, который просто нажал «Выход».
    forgetSessionEndedNotice();
    setSessionEndedNotice(null);
    setToken(null);
    setUser(null);
  };

  const hasPermission = (perm: keyof UserPermissions): boolean => {
    if (!user) return false;
    // Байпас ТОЛЬКО для superadmin/director («Директор всегда полные права»).
    // admin НЕ байпасит: он живёт по permissions из /auth/me — сервер отдаёт
    // эффективные права из матрицы назначенной роли (волна «права как в
    // Битрикс24»: admin снят и из серверного OWNER_CLASS_ROLES). После правки
    // роли клиент должен рефетчить /auth/me (см. refreshUser в RolesManagement).
    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.DIRECTOR) return true;
    return !!user.permissions?.[perm];
  };

  const isRole = (...roles: UserRole[]): boolean => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  // Стабильная ссылка: экран входа гасит причину из useEffect, и меняющаяся
  // на каждом рендере функция гоняла бы этот эффект по кругу.
  const clearSessionEndedNotice = useCallback(() => {
    forgetSessionEndedNotice();
    setSessionEndedNotice(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        loginWithPoint,
        switchPoint,
        logout,
        refreshUser,
        hasPermission,
        isRole,
        sessionEndedNotice,
        clearSessionEndedNotice,
      }}
    >
      {children}
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
