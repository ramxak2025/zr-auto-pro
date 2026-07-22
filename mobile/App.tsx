import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, StatusBar } from 'react-native';
import { CommonActions, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { MutationCache, QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import NetInfo from '@react-native-community/netinfo';
import * as Font from 'expo-font';
import * as Notifications from 'expo-notifications';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider, useThemeMode } from './src/contexts/ThemeContext';
import { SalaryNotificationProvider } from './src/contexts/SalaryNotificationContext';
import { BroadcastNotificationProvider } from './src/contexts/BroadcastNotificationContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import SplashOverlay from './src/components/SplashOverlay';
import OfflineBanner from './src/components/OfflineBanner';
import ToastHost, { showMutationErrorToast, showToast } from './src/components/Toast';
import { colors } from './src/theme';
import { haptic } from './src/platform/haptics';
import UpdateGate from './src/components/UpdateGate';
import { hydrateCache, hydratePriorityCache, attachPersistence } from './src/utils/persistentCache';
import { attachForegroundRevalidation } from './src/utils/foregroundRevalidation';
import { attachOtaUpdates } from './src/utils/otaUpdates';
import { attachBackendRecovery, createApiRouteRecoveryController } from './src/utils/backendRecovery';
import {
  attachOfflineCheckQueue,
  kickOfflineCheckQueueOnNetworkSuccess,
  type QueuedCheck,
} from './src/utils/offlineCheckQueue';
import { shouldRetryTransient, transientRetryDelay } from './src/utils/queryRetry';
import { ensureApiHostReady, onNetworkClassFailure, onRequestSucceeded, reselectApiHost } from './src/api/axios';
import { checksApi, clientsApi, loyaltyApi } from './src/api/services';

// NetInfo's DEFAULT reachability probe hits clients3.google.com in the
// background. The `isInternetReachable` verdict it produces is IGNORED
// everywhere in this app (the listener below reads only `isConnected`, and
// OfflineBanner runs its own dual probe) — so this configure() changes no
// online/offline behavior at all. It exists ONLY so the system probe stops
// hammering a Google host that RF carriers filter (wasted radio + endless
// slow retries under VPN): point it at Яндекс with a VPN-tolerant timeout.
// Must run BEFORE addEventListener below.
NetInfo.configure({
  reachabilityUrl: 'https://ya.ru/robots.txt',
  reachabilityTest: async (response) => response.status === 200,
  reachabilityRequestTimeout: 6_000,
  reachabilityShouldRun: () => true,
});

// Wire TanStack Query's onlineManager to the real device connectivity
// (NetInfo). Without this RN has no `online`/`offline` browser events, so
// React Query would consider the app permanently online: offline queries
// would burn their retry and error out instead of pausing, and the
// OfflineBanner below would have no source of truth.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    // Offline ONLY when the link itself is down (`isConnected === false`).
    // We deliberately IGNORE `isInternetReachable` here: its false negatives
    // (VPN latency, carrier whitelist windows filtering the probe host) used
    // to pause EVERY React Query request and show a lying "Нет подключения"
    // banner while the API was perfectly reachable — «через VPN не грузит».
    // The opposite case — a captive portal / dead-upstream Wi-Fi that is
    // "connected" but useless — is already covered elsewhere: the HTML guard
    // (isHtmlApiPayload) rejects portal pages, the transparent retry +
    // failover ring absorbs the failure, and the OfflineBanner runs its own
    // dual probe to tell the user the truth. `isConnected === null` (unknown,
    // cold start) counts as online to avoid a false-offline flash.
    setOnline(state.isConnected !== false);
  }),
);

// Start routing initialization as soon as the JS bundle evaluates. Unlike the
// old fire-and-forget launch race, request/session restore can await this shared
// promise, and App delays the eager offline-check sender until it settles:
// persisted-host restore and the whole-ring happy-eyeballs selection therefore
// finish before authenticated request waves can choose a stale/dead base. The
// login UI itself is not gated, so a logged-out/offline cold start stays fast.
const apiRoutingInitialization = ensureApiHostReady().catch(() => {});

// Configure how notifications are handled when the app is in the foreground.
// Must be set before any notification arrives — top-level call outside component.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const queryClient = new QueryClient({
  // Глобальный перехват ошибок мутаций (волна C «Связь 2.0», C-1). Раньше
  // фолбэк жил в defaultOptions.mutations.onError — и любой локальный onError
  // (даже чисто для отката optimistic-кеша) МОЛЧА перекрывал глобальный Alert:
  // так накопился десяток «молчаливых» мутаций, где несохранённая запись не
  // показывала вообще ничего. mutationCache.onError вызывается ВСЕГДА, до
  // локального обработчика, поэтому правило видимости живёт здесь:
  //   • у мутации ЕСТЬ свой options.onError → cache-слой молчит: ~150 мутаций
  //     показывают собственный Alert/inline-ошибку, двойных алертов нет;
  //     rollback-only обработчики ОБЯЗАНЫ сами показать тост (см.
  //     showMutationErrorToast — Schedule/WorkBoard/Booking/Notification и
  //     др. уже добиты);
  //   • onError НЕТ → тот же класс, что покрывал старый глобальный Alert
  //     (options.onError после переноса существует ⇔ мутация объявила СВОЙ
  //     обработчик), но теперь необлокирующий тост «Не сохранено…» с текстом
  //     серверной ошибки, если она есть;
  //   • meta.showsOwnError === true → opt-out для мутаций, которые рисуют
  //     ошибку inline-состоянием без onError.
  mutationCache: new MutationCache({
    onError: (err, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      if (mutation.meta?.showsOwnError === true) return;
      haptic('error');
      showMutationErrorToast(err);
    },
  }),
  defaultOptions: {
    queries: {
      // Mobile: longer staleTime so revisiting a screen within 2 min doesn't
      // refetch — the user perceives the app as instant.
      staleTime: 2 * 60 * 1000,
      // Keep query data alive for 30 min after last unmount, so a tab swipe
      // back doesn't lose the cache.
      gcTime: 30 * 60 * 1000,
      // Retry policy (see utils/queryRetry.ts): NEVER retry 4xx — they are
      // deterministic (403 master hitting an owner-only endpoint, 404 deleted
      // entity, 400 validation); retrying only doubles the spinner for an
      // answer that cannot change. For TRANSIENT failures — network errors (no
      // err.response), timeouts, and any 5xx (502/503/504) — retry up to 6
      // times with capped exponential backoff + jitter (~31s of coverage).
      // ROOT CAUSE FIXED: the old policy gave up after ~1.5s, far shorter than
      // a 5–15s backend redeploy 502 window, so every section errored out at
      // once and a manual «Повторить» fired inside the same window failed
      // again ("повторить не помогает"). The wider budget rides through a
      // deploy invisibly (cache + placeholderData keep paint instant
      // meanwhile); backendRecovery heals anything still errored once /health
      // returns. Jitter de-syncs the post-login fan-out off the recovering
      // backend.
      retry: shouldRetryTransient,
      retryDelay: (attempt: number) => transientRetryDelay(attempt),
      refetchOnWindowFocus: false,
      // Global stale-while-revalidate: when a queryKey changes (eg. paging,
      // search, filters), keep showing the previous data until the new one
      // arrives instead of dropping back to a loading state. This is the
      // single biggest perceptible-perf win — search/pager swaps feel native.
      placeholderData: (prev: unknown) => prev,
    },
    mutations: {
      // Mutations must FAIL FAST when offline instead of pausing forever:
      // with the default networkMode 'online' an offline mutate() never
      // settles, so every button gated on `isPending` would hang until the
      // network returns. 'always' lets axios fail immediately → onError.
      networkMode: 'always',
      // Глобальный фолбэк для мутаций БЕЗ локального onError переехал в
      // mutationCache.onError выше: класс покрытия тот же (options.onError
      // после переноса существует только у мутаций со СВОИМ обработчиком),
      // но новый rollback-only onError больше не может молча съесть
      // глобальный фидбек — cache-слой видит его и знает, что экран сам
      // отвечает за видимую ошибку.
    },
  },
});

// ── HOT query keys: 30s staleTime ────────────────────────────────────────────
// The global 2min staleTime is right for reference data (services, categories,
// users), but the screens users actually WATCH change — journal, склад,
// dashboard, schedule, suppliers — felt stale: renavigating within 2 minutes
// showed old numbers with no revalidation. Per-prefix defaults below drop
// staleTime to 30s for those keys only: persistent cache + global
// `placeholderData: prev => prev` still paint instantly from the previous
// data, and a background refetch fires whenever the screen (re)mounts after
// 30s. setQueryDefaults merges OVER defaultOptions and UNDER per-query
// options, so placeholderData / retry / gcTime are untouched, and any screen
// that sets its own staleTime keeps it.
//
// Interplay with foregroundRevalidation (attachForegroundRevalidation below):
// no double-refetch storm. Foreground transitions INVALIDATE their own key
// whitelist (one coalesced wave per 1s window) — invalidation refetches
// active queries regardless of staleTime, and a freshly refetched query has
// dataUpdatedAt ≈ now, so a navigation right after foregrounding is within
// the 30s window and does NOT trigger a second fetch. The two mechanisms
// cover disjoint triggers: AppState→active vs. screen remount.
const HOT_QUERY_PREFIXES: readonly string[][] = [
  ['checks-infinite'],
  ['products'],
  ['all-products-check'],
  ['clients-infinite'],
  ['dashboard-v2'],
  ['dashboard-chart'],
  ['schedule'],
  ['schedule-today'],
  ['warehouse-analytics'],
  ['suppliers'],
];
for (const prefix of HOT_QUERY_PREFIXES) {
  queryClient.setQueryDefaults(prefix, { staleTime: 30_000 });
}

// ── Офлайн-очередь чеков: wiring (Round 9) ───────────────────────────────────
// Сам движок — utils/offlineCheckQueue.ts (см. его шапку). Здесь только
// приложение-специфичная обвязка: чем отправлять, что инвалидировать после
// успешной досылки и как уведомить пользователя.

/**
 * После досылки отложенного чека бустим ТОТ ЖЕ набор ключей, что и обычное
 * создание чека (CheckCreateScreen → createMutation.onSuccess; при изменении
 * списка там — синхронизировать здесь): Журнал и Склад refetch'ем, тяжёлые
 * ключи — только пометка stale (`refetchType: 'none'`), гарантии/последний
 * визит — сброс по префиксу.
 */
function invalidateAfterQueuedCheckSent(): void {
  queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
  queryClient.invalidateQueries({ queryKey: ['products'] });
  const heavyKeys: string[][] = [
    ['checks'],
    ['checks-dashboard'],
    ['dashboard-v2'],
    ['dashboard-chart'],
    ['cashflow'],
    ['low-stock'],
    ['all-products-check'],
    ['warehouse-analytics'],
    // Деньги чека каскадно меняют зарплату, мотивацию, фин-отчёт, рейтинг и
    // историю клиента (backend считает их ИЗ checks) — зеркало списка в
    // CheckCreateScreen.onSuccess (mobile-audit C1).
    ['salary'],
    ['salary-employee-month'],
    ['motivation'],
    ['financial-report'],
    ['employee-ranking'],
    ['client-checks'],
    ['client-checks-full'],
    ['retail-checks'],
    ['retail-checks-full'],
  ];
  for (const queryKey of heavyKeys) {
    queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
  }
  queryClient.invalidateQueries({ queryKey: ['warranty-active-client'] });
  queryClient.invalidateQueries({ queryKey: ['last-visit'] });
}

/**
 * Кешбэк лояльности для чека, досланного из офлайн-очереди (mobile-audit M3).
 * Живой путь кассы начисляет его в createMutation.onSuccess
 * (CheckCreateScreen: `!editId && savedCheckId && clientId &&
 * !selectedClient?.isRetail`); при стэше в очередь чека на сервере ещё нет,
 * поэтому начисление выполняем здесь — после успешной досылки. Payload не
 * несёт isRetail, а ответ create его не отдаёт — переспрашиваем клиента
 * (розничному покупателю бонусы не начисляются). Best-effort и fire-and-forget,
 * как в живом пути: сумму считает СЕРВЕР, ошибки (422 «лояльность выключена»,
 * сеть) глушим — чек уже отправлен, блокировать нечего.
 */
async function accrueLoyaltyForQueuedCheck(entry: QueuedCheck, result: unknown): Promise<void> {
  const clientId = typeof entry.payload.clientId === 'string' ? entry.payload.clientId : '';
  const checkId = (result as { id?: string } | null | undefined)?.id;
  if (!clientId || !checkId) return;
  try {
    const client = await clientsApi.getById(clientId);
    if (client.data?.isRetail) return;
    await loyaltyApi.accrue({ clientId, checkId });
    queryClient.invalidateQueries({ queryKey: ['loyalty', 'client', clientId] });
  } catch {
    /* лояльность выключена/не настроена/сеть — тихо, чек уже в журнале */
  }
}

/**
 * Тихое подтверждение досылки — локальная нотификация (foreground-handler
 * выше уже показывает баннер), НЕ Alert: досылка фоновая, блокировать
 * пользователя посреди другого экрана нельзя. Без прав на нотификации (или
 * при отказе шедулера) раньше была ПОЛНАЯ тишина — теперь фолбэк-тост
 * «Чек №N отправлен» (волна C, C-6): мастер видит подтверждение, а не
 * гадает, ушёл ли чек.
 */
function notifyQueuedCheckSent(entry: QueuedCheck, result: unknown): void {
  const number = (result as { number?: number } | null | undefined)?.number;
  const client = entry.meta?.clientName;
  void (async () => {
    let delivered = false;
    try {
      const perms = await Notifications.getPermissionsAsync();
      const canNotify = perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
      if (canNotify) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Отложенный чек отправлен',
            body: `${number ? `Чек №${number}` : 'Чек'}${client ? ` · ${client}` : ''} записан в журнал`,
            sound: false,
          },
          trigger: null,
        });
        delivered = true;
      }
    } catch {
      // Права/шедулер недоступны — ниже покажем тост.
    }
    if (!delivered) {
      showToast(number ? `Чек №${number} отправлен — записан в журнал` : 'Отложенный чек отправлен', 'success');
    }
  })();
}

/**
 * Сервер детерминированно отклонил отложенный чек (4xx) — единожды показываем
 * его русское сообщение. Данные НЕ пропадают: запись лежит в bucket'е
 * «Отклонён» шита «Ожидают отправки» (Журнал) с «Повторить» / «Удалить».
 */
function alertQueuedCheckRejected(entry: QueuedCheck, message: string): void {
  const total = entry.meta?.total;
  const label = total ? `Чек на ${Math.round(total)} ₽` : 'Отложенный чек';
  Alert.alert(
    'Отложенный чек не принят',
    `${label} отклонён сервером:\n${message}\n\nОн остался в Журнале в списке «Ожидают отправки» — можно повторить отправку или удалить.`,
  );
}

// ── Push-tap navigation ──────────────────────────────────────────────────────
// Root navigation ref lets the notification-response listener (which lives
// OUTSIDE the navigator tree) deep-link into the app. `CheckDetail` is NOT
// registered on the root stack — it lives inside the Checks tab's nested
// stack (ChecksStack), so we navigate Main → Checks → CheckDetail; the tab
// bar stays visible, exactly like opening a check from Журнал by hand.
const navigationRef = createNavigationContainerRef();

// Cold-start queue: a tap on a push can arrive before the navigator has
// mounted (auth still resolving). Park the checkId and flush it in onReady.
let pendingCheckId: string | null = null;

// Dedupe guard — the same response can surface both via the live listener
// and via getLastNotificationResponseAsync() on cold start.
let lastHandledNotificationId: string | null = null;

function openCheckFromPush(checkId: string): void {
  if (!navigationRef.isReady()) {
    pendingCheckId = checkId;
    return;
  }
  navigationRef.dispatch(
    CommonActions.navigate('Main', {
      screen: 'Checks',
      params: { screen: 'CheckDetail', initial: false, params: { id: checkId } },
    }),
  );
}

function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const id = response.notification.request.identifier;
  if (id && id === lastHandledNotificationId) return;
  lastHandledNotificationId = id;
  const data = response.notification.request.content.data as Record<string, unknown>;
  // When the notification carries a checkId, navigate to that check.
  if (data?.checkId) {
    openCheckFromPush(String(data.checkId));
  }
  // Tapped superadmin broadcast while backgrounded: no navigation needed —
  // the BroadcastNotificationProvider re-fetches unseen broadcasts whenever
  // the app returns to the foreground (AppState → 'active'). Bringing the
  // app forward via the tap therefore surfaces the modal on its own.
}

export default function App() {
  const [apiRoutingReady, setApiRoutingReady] = useState(false);
  const [cacheReady, setCacheReady] = useState(false);
  const [priorityHydrated, setPriorityHydrated] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const persistenceCleanup = useRef<(() => void) | null>(null);
  const foregroundCleanup = useRef<(() => void) | null>(null);
  const recoveryCleanup = useRef<(() => void) | null>(null);
  const offlineQueueCleanup = useRef<(() => void) | null>(null);
  const netSuccessCleanup = useRef<(() => void) | null>(null);

  // Track completion for recovery listeners and UpdateGate. AuthProvider stays
  // mounted so a logged-out/offline user sees the login form immediately; the
  // shared axios request/login paths await ensureApiHostReady before traffic.
  useEffect(() => {
    let mounted = true;
    void apiRoutingInitialization.then(() => {
      if (mounted) setApiRoutingReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Subscribe to cache updates IMMEDIATELY so queries that fire while
    // hydration is still in progress get persisted on success. Previously
    // we waited for hydration to finish before subscribing, which meant
    // the first batch of post-login queries silently bypassed the cache.
    persistenceCleanup.current = attachPersistence(queryClient);
    // Foreground revalidation — invalidate critical dashboard/journal
    // queries whenever the app comes back to `active` state. So the user
    // who put the phone down at lunch and reopens at 14:00 sees the
    // freshest cash position immediately, instead of yesterday's snapshot
    // plus a manual pull-to-refresh.
    foregroundCleanup.current = attachForegroundRevalidation(queryClient);
    // Delay eager background traffic until the routing barrier. Auth/login
    // remain responsive because axios itself awaits the same barrier only when
    // a real request is sent; attachOfflineCheckQueue, however, performs an
    // eager flush after hydration and should not even start before selection.
    void apiRoutingInitialization.then(() => {
      if (cancelled) return;
      // Backend-recovery self-heal: query failures re-probe the WHOLE ring and
      // refetch the errored active queries after adopting a healthy host.
      recoveryCleanup.current = attachBackendRecovery(queryClient);
      // Офлайн-очередь чеков (Round 9): гидратация + досылка хвоста прошлой
      // сессии + триггеры (foreground / 60s-таймер пока непуста). Отправка —
      // живой checksApi.create: payload несёт clientRequestId, поэтому досылка
      // «полудоставленного» чека вернёт уже созданный, а не задвоит его.
      offlineQueueCleanup.current = attachOfflineCheckQueue({
        send: (payload) => checksApi.create(payload as never).then((res) => res.data),
        onSent: (entry, result) => {
          invalidateAfterQueuedCheckSent();
          void accrueLoyaltyForQueuedCheck(entry, result);
          notifyQueuedCheckSent(entry, result);
        },
        onRejected: alertQueuedCheckRejected,
        appState: AppState,
        // C-5: возврат сети (onlineManager ← NetInfo выше) кикает досылку
        // СРАЗУ, а не через ≤60с-таймер / первый успешный axios-ответ.
        online: onlineManager,
      });
      // Третий flush-триггер: ЛЮБОЙ успешный ответ axios — сеть доказуемо
      // вернулась (дебаунс внутри очереди, пустая очередь — мгновенный no-op).
      netSuccessCleanup.current = onRequestSucceeded(kickOfflineCheckQueueOnNetworkSuccess);
    });
    // Audit #8.7 — cold-start hydrate race. Step 1: synchronously hydrate
    // ONLY the priority first-screen keys (Dashboard / Журнал / Склад),
    // bounded to ~80ms. The splash stays up until this resolves so a fast
    // user reaching those screens never sees an empty flash. This is cheap:
    // a filtered multiGet over a handful of keys, with an internal watchdog
    // that guarantees boot is never blocked past the budget.
    hydratePriorityCache(queryClient).finally(() => {
      if (!cancelled) setPriorityHydrated(true);
      // Step 2: the FULL whitelist (~60 keys) hydrates in the background —
      // we do NOT gate first render on it. The AsyncStorage multiGet +
      // JSON.parse loop costs ~200-500ms; while it runs the UI is already
      // interactive, and once a cached entry lands, `setQueryData` flips any
      // active `useQuery` to that data instantly (no flicker — global
      // `placeholderData` covers the transition). Re-hydrating the priority
      // keys here is idempotent.
      hydrateCache(queryClient).finally(() => {
        if (!cancelled) setCacheReady(true);
      });
    });
    return () => {
      cancelled = true;
      persistenceCleanup.current?.();
      persistenceCleanup.current = null;
      foregroundCleanup.current?.();
      foregroundCleanup.current = null;
      recoveryCleanup.current?.();
      recoveryCleanup.current = null;
      offlineQueueCleanup.current?.();
      offlineQueueCleanup.current = null;
      netSuccessCleanup.current?.();
      netSuccessCleanup.current = null;
    };
  }, []);

  // Re-evaluate the complete API ring whenever the device's usable route may
  // have changed. NetInfo emits plenty of noisy telemetry, so compare only a
  // stable route signature (connection/type/SSID/IP/carrier) and ignore mere
  // reachability or signal-strength updates. Foreground is an independent
  // trigger because a VPN can be toggled while the app is suspended without a
  // reliable NetInfo event. A final axios network failure is the last-resort
  // trigger for DNS/carrier filtering that leaves NetInfo looking unchanged.
  // The selector itself owns debounce, in-flight dedupe and stale-result
  // protection, so nearly simultaneous triggers safely collapse into one race.
  useEffect(() => {
    if (!apiRoutingReady) return;

    const routeRecovery = createApiRouteRecoveryController({
      initialAppState: AppState.currentState,
      reselect: reselectApiHost,
    });
    const unsubscribeNetInfo = NetInfo.addEventListener(routeRecovery.onNetworkState);
    const appStateSubscription = AppState.addEventListener('change', routeRecovery.onAppState);
    const unsubscribeNetworkFailure = onNetworkClassFailure(routeRecovery.onNetworkFailure);

    return () => {
      unsubscribeNetInfo();
      appStateSubscription.remove();
      unsubscribeNetworkFailure();
    };
  }, [apiRoutingReady]);

  // EAS Updates (OTA): тихая догрузка свежего JS-бандла при возврате в
  // foreground — применяется на следующем холодном старте, никаких reload
  // посреди работы мастера. No-op в dev / Expo Go (см. utils/otaUpdates.ts).
  useEffect(() => attachOtaUpdates(), []);

  // Pre-load icon fonts even though icons render as SVG. This stays
  // as a no-op safety net for any legacy code path that still emits
  // a Text-based glyph — they won't render as empty boxes.
  useEffect(() => {
    let cancelled = false;
    Font.loadAsync({
      ...(Ionicons as any).font,
      ...(MaterialCommunityIcons as any).font,
    })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Notification response listener — handles taps on push notifications
  // while the app is backgrounded or cold-started from a notification.
  // The actual navigation lives in handleNotificationResponse above (root
  // navigationRef + cold-start queue). getLastNotificationResponseAsync
  // covers the killed-app case, where the live listener can miss the tap
  // that launched the process; the identifier dedupe inside the handler
  // makes the two paths safe to run together.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationResponse(response);
      })
      .catch(() => {});
    return () => sub.remove();
  }, []);

  // Live-cash push listener — the backend sends a DATA-ONLY Expo push
  // `{ data: { type: 'cash-changed', tenantId } }` to OTHER tenant users
  // after a check / payment / expense. When received in the foreground we
  // invalidate the money query keys so the open screen updates live across
  // devices — a faster path that pairs with the existing 30s focus-poll.
  // Rapid pushes are coalesced (ignore if we invalidated < 2s ago) so a
  // burst of writes on another device triggers a single refetch wave here.
  useEffect(() => {
    let lastInvalidatedAt = 0;
    const COALESCE_MS = 2000;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (data?.type !== 'cash-changed') return;
      const now = Date.now();
      if (now - lastInvalidatedAt < COALESCE_MS) return;
      lastInvalidatedAt = now;
      // Money keys mirrored from the write-side invalidations in
      // CheckCreate / CheckDetail / Checks / Salary / CashFlow screens.
      // Round 7 audit #2: only the two surfaces the user actually watches
      // live (Главная + Журнал — always-mounted tabs) refetch actively;
      // cashflow / expenses are just marked stale (`refetchType: 'none'`)
      // and revalidate via their own focus-gated 30s polls / remount —
      // a push must never fan out into a hidden refetch storm.
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'], refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: ['expenses'], refetchType: 'none' });
    });
    return () => sub.remove();
  }, []);

  // Splash is gated on auth resolution + font load + the bounded priority
  // hydration. The FULL persistent-cache hydration stays decoupled — it runs
  // in the background and updates queries as it progresses. Gating on
  // `priorityHydrated` (capped at ~80ms) closes the audit #8.7 empty-flash on
  // the first screens without measurably slowing boot. See the effect above.
  const showSplash = !authResolved || !fontsReady || !priorityHydrated;

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ThemedRoot
          apiRoutingReady={apiRoutingReady}
          cacheReady={cacheReady}
          fontsReady={fontsReady}
          showSplash={showSplash}
          onAuthResolve={() => setAuthResolved(true)}
        />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

interface ThemedRootProps {
  apiRoutingReady: boolean;
  cacheReady: boolean;
  fontsReady: boolean;
  showSplash: boolean;
  onAuthResolve: () => void;
}

/**
 * ThemedRoot — pulls the active palette out of ThemeContext so the
 * SafeAreaProvider background, NavigationContainer theme, and StatusBar
 * style all flip with the dark-mode toggle. Living one level inside
 * <ThemeProvider> is the cleanest way to subscribe.
 */
function ThemedRoot({ apiRoutingReady, cacheReady, fontsReady, showSplash, onAuthResolve }: ThemedRootProps) {
  const { mode, palette } = useThemeMode();
  return (
    <SafeAreaProvider style={{ backgroundColor: palette.bg.canvas }}>
      {/* KeyboardProvider (react-native-keyboard-controller) — источник
          синхронных кадров клавиатуры для KeyboardAvoidingView /
          KeyboardAwareScrollView (см. components/KeyboardAware.tsx). Живёт
          высоко, над навигацией и всеми модалками, чтобы «поле над
          клавиатурой» работало одинаково на iOS и Android (Round 11 #1).
          JSI-модуль — требует native rebuild. */}
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider queryClient={queryClient} onAuthResolve={onAuthResolve}>
            {/* SalaryNotificationProvider mounts the global "Деньги пришли"
              modal that pops up over any tab/screen when the current user
              has an unconfirmed salary payment. Must live INSIDE
              AuthProvider so it can read `useAuth()`, and inside
              QueryClientProvider so it can use the shared queryClient. */}
            {/* BroadcastNotificationProvider mounts the global superadmin
              broadcast modal — a center-screen blur-behind card that pops
              when «поддержка» sends an announcement. Lives alongside the
              salary modal provider (same AuthProvider + QueryClient scope). */}
            <SalaryNotificationProvider>
              <BroadcastNotificationProvider>
                <NavigationContainer
                  ref={navigationRef}
                  onReady={() => {
                    // Flush a push-tap that arrived before the navigator
                    // mounted (cold start from a notification).
                    if (pendingCheckId) {
                      const id = pendingCheckId;
                      pendingCheckId = null;
                      openCheckFromPush(id);
                    }
                  }}
                  theme={{
                    dark: mode === 'dark',
                    colors: {
                      primary: palette.accent.primary,
                      background: palette.bg.canvas,
                      card: 'transparent',
                      text: palette.text.primary,
                      border: palette.border.subtle,
                      notification: palette.accent.primary,
                    },
                    fonts: {
                      regular: { fontFamily: 'System', fontWeight: '400' },
                      medium: { fontFamily: 'System', fontWeight: '500' },
                      bold: { fontFamily: 'System', fontWeight: '700' },
                      heavy: { fontFamily: 'System', fontWeight: '900' },
                    },
                  }}
                >
                  <StatusBar
                    barStyle={mode === 'dark' ? 'light-content' : 'dark-content'}
                    backgroundColor="transparent"
                    translucent
                  />
                  {fontsReady && <AppNavigator />}
                  {/* Offline strip mounts BEFORE the splash so the splash
                    still covers it during boot. Renders null while online. */}
                  <OfflineBanner />
                  {/* Глобальный тост (C-1/C-2/C-6): «Не сохранено…» из
                    mutationCache + подтверждение досылки чека. Renders null
                    без активного тоста; под сплешем — как и баннер. */}
                  <ToastHost />
                  {showSplash && <SplashOverlay />}
                </NavigationContainer>
              </BroadcastNotificationProvider>
            </SalaryNotificationProvider>
          </AuthProvider>
        </QueryClientProvider>
        {/* Kill-switch «минимальная версия клиента» — ПОВЕРХ всего дерева,
            включая сплеш и навигацию. Рендерит null, пока сервер не выставил
            минимум выше текущей сборки (см. components/UpdateGate.tsx). Живёт
            вне QueryClientProvider сознательно: обычный fetch + локальный
            state, никаких зависимостей от auth/query. */}
        {apiRoutingReady && <UpdateGate />}
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

// Silence unused-warning for the legacy import path that App.tsx
// re-exports indirectly (kept here so tree-shaking of `colors` stays
// referenced for tooling that scans named exports).
void colors;
