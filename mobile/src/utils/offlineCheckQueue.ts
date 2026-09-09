/**
 * offlineCheckQueue — офлайн-очередь чеков: «чек не теряется — улетает, когда
 * появится сеть».
 *
 * ПОЧЕМУ (Round 9, пакет надёжности связи): в сети автосервиса владельца
 * мобильный оператор фильтрует домен API — POST /checks умирает без ответа, и
 * до этого модуля мастер терял набитый чек («Не удалось сохранить»). Теперь
 * СЕТЕВОЙ отказ сабмита (нет ответа / 502 / 503 / 504) складывает точный
 * payload чека в AsyncStorage, а flush-движок дошлёт его, как только сеть
 * вернётся. Валидационные отказы (400/403/409/422…) в очередь НЕ попадают —
 * они детерминированные и всплывают пользователю как раньше.
 *
 * ИДЕМПОТЕНТНОСТЬ: сервер принимает опциональный `clientRequestId` (UUID v4,
 * lowercase; non-UUID → 400) и гарантирует максимум один чек на
 * (tenant, clientRequestId) — повторный POST возвращает УЖЕ созданный чек без
 * повторного списания склада/зарплаты/выручки. Ключ генерируется ОДИН раз ДО
 * первого живого POST (см. CheckCreateScreen.proceed) и хранится в записи
 * очереди, поэтому даже «полудоставленный» первый запрос (сервер записал,
 * ответ потерялся) не может задвоиться при досылке.
 *
 * FLUSH-ТРИГГЕРЫ (все дешёвые, все no-op при пустой очереди):
 *   1. выход приложения на передний план (AppState → 'active');
 *   2. таймер каждые 60 с, ПОКА очередь непуста (старт/стоп по подписке);
 *   3. любой успешный ответ axios — сеть доказуемо вернулась
 *      (kickFromNetworkSuccess, дебаунс 15 с, чтобы волна запросов не спамила);
 *   4. ручное «Отправить сейчас» из шита в Журнале;
 *   5. возврат online-статуса (инжектированный onlineManager ← NetInfo,
 *      волна C, C-5) — досылка стартует СРАЗУ при возврате сети, без
 *      ожидания таймера/чужого запроса; onlineManager эмитит только СМЕНУ
 *      статуса, так что триггер не спамит.
 *
 * FLUSH-СЕМАНТИКА: строго последовательно, по одному, в порядке добавления.
 *   • успех → запись удаляется, вызывается onSent (инвалидация журнала/
 *     дашборда + тихое уведомление — wiring в App.tsx);
 *   • сетевой/5xx отказ → запись остаётся pending, attempts++, раунд
 *     останавливается (сервер недоступен — молотить остальные бессмысленно);
 *   • детерминированный 4xx (кроме 401/429) → запись переезжает в bucket
 *     'failed' с русским сообщением сервера и НЕ ретраится автоматически;
 *     пользователь видит её в шите «Ожидают отправки» с «Повторить»/«Удалить»
 *     — отклонённый чек никогда не исчезает молча. 401 (протухшая сессия) и
 *     429 (rate-limit) — временные: остаются pending до следующего триггера.
 *
 * АРХИТЕКТУРА (в стиле utils/backendRecovery.ts): ядро
 * `createOfflineCheckQueueCore` полностью dependency-injected и БЕЗ top-level
 * runtime-импортов react-native — поэтому детерминированно тестируется под
 * node-jest (jest здесь не транспилирует node_modules, так что импорт
 * AsyncStorage/react-native на верхнем уровне сломал бы тесты). Синглтон
 * получает AsyncStorage через ленивый require, а AppState/checksApi/
 * queryClient инжектятся из App.tsx через `attachOfflineCheckQueue`.
 */
import { useSyncExternalStore } from 'react';

import { extractApiErrorMessage } from './apiError';

// ── Типы ────────────────────────────────────────────────────────────────────

export type QueuedCheckStatus = 'pending' | 'failed';

/** Display-метаданные для шита «Ожидают отправки» (payload несёт только id). */
export interface QueuedCheckMeta {
  /** Итог «К оплате» на момент сабмита (для строки в шите). */
  total?: number;
  clientName?: string;
  /** «Марка модель · госномер» выбранного авто. */
  carInfo?: string;
}

/**
 * Payload чека — байт-в-байт тот объект, что ушёл бы в checksApi.create.
 * Для очереди он непрозрачен; обязателен только clientRequestId (identity +
 * серверная идемпотентность).
 */
export type QueuedCheckPayload = Record<string, unknown> & { clientRequestId: string };

export interface QueuedCheck {
  clientRequestId: string;
  payload: QueuedCheckPayload;
  createdAt: number;
  attempts: number;
  status: QueuedCheckStatus;
  /** Русское сообщение сервера после детерминированного 4xx-отказа. */
  failedMessage?: string;
  meta?: QueuedCheckMeta;
}

export interface FlushResult {
  /** Отправлено (и удалено из очереди) за этот раунд. */
  sent: number;
  /** Переехало в bucket 'failed' за этот раунд. */
  rejected: number;
  /** Осталось записей (pending + failed) после раунда. */
  remaining: number;
}

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Отправка одного чека на сервер (App.tsx подставляет checksApi.create). */
export type SendQueuedCheck = (payload: QueuedCheckPayload) => Promise<unknown>;

export interface OfflineCheckQueueCoreDeps {
  storage: QueueStorage;
  now?: () => number;
}

// ── Константы ───────────────────────────────────────────────────────────────

/** Версионированный ключ AsyncStorage — смена схемы = новый суффикс. */
export const OFFLINE_CHECK_QUEUE_STORAGE_KEY = 'offline_check_queue_v1';

/** Дебаунс flush-триггера «любой успешный ответ axios». */
export const NETWORK_SUCCESS_KICK_DEBOUNCE_MS = 15_000;

/** Период фонового таймера, пока очередь непуста. */
export const QUEUE_FLUSH_INTERVAL_MS = 60_000;

const STORAGE_VERSION = 1;

// ── Генерация clientRequestId (UUID v4, lowercase) ─────────────────────────
// В кодбазе не было uuid-утилиты (ни uuid-пакета, ни expo-crypto), поэтому
// ярусы: native-генератор expo-modules-core (globalThis.expo.uuidv4 — есть в
// рантайме приложения), Web Crypto randomUUID (node/jest, будущий Hermes),
// затем чистый Math.random-фолбэк. Сервер отвечает 400 на не-UUID и требует
// lowercase — поэтому результат всегда прогоняется через lowercase + regex.

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** true, если строка — валидный lowercase UUID v4 (формат, который ждёт бэк). */
export function isValidClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

/**
 * Чистый UUID v4 из инжектируемого RNG — детерминированно тестируемый фолбэк.
 * Энтропия Math.random слабее crypto, но для ключа идемпотентности в масштабе
 * «чеки одного тенанта» коллизия пренебрежима, а формат — строго v4.
 */
export function uuidV4FromRandom(rand: () => number = Math.random): string {
  const bytes: number[] = new Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(rand() * 256) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` + `${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID v4 lowercase: expo native → Web Crypto → Math.random-фолбэк. */
export function generateClientRequestId(): string {
  try {
    const nativeUuidV4 = (globalThis as { expo?: { uuidv4?: () => string } }).expo?.uuidv4;
    if (typeof nativeUuidV4 === 'function') {
      const value = String(nativeUuidV4()).toLowerCase();
      if (isValidClientRequestId(value)) return value;
    }
  } catch {
    // native-генератор недоступен — падаем ниже
  }
  try {
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (typeof webCrypto?.randomUUID === 'function') {
      const value = String(webCrypto.randomUUID()).toLowerCase();
      if (isValidClientRequestId(value)) return value;
    }
  } catch {
    // crypto недоступен — падаем ниже
  }
  return uuidV4FromRandom();
}

// ── Классификация ошибок ────────────────────────────────────────────────────

/**
 * СЕТЕВОЙ класс отказа сабмита — ТОЛЬКО такие чеки уходят в очередь:
 * нет ответа вовсе (timeout / DNS / offline / обёрнутая axios'ом ошибка
 * соединения) либо шлюзовые 502/503/504. Детерминированные 400/401/403/409/
 * 422 и прочие ответы сервера — НЕ сетевые: они всплывают пользователю сразу,
 * как и раньше.
 */
export function isNetworkClassCheckError(error: unknown): boolean {
  const candidate = error as { response?: { status?: number }; code?: string; __CANCEL__?: unknown } | null | undefined;
  // Отмена запроса (axios CanceledError / staleAuthCancellation при смене
  // auth-сессии) — ДЕТЕРМИНИРОВАННЫЙ отказ, не сетевой. Такой чек в очередь
  // класть НЕЛЬЗЯ: очередь безусловно чистится при следующем логине
  // (clearPreviousTenantStorage), и ложный «сохранён на телефоне» превратился
  // бы в тихую потерю чека. Экран обязан показать честную ошибку.
  if (candidate?.code === 'ERR_CANCELED' || candidate?.__CANCEL__) return false;
  const response = candidate?.response;
  if (!response) return true;
  const status = response.status;
  return status === 502 || status === 503 || status === 504;
}

/**
 * Детерминированный отказ сервера при ДОСЫЛКЕ из очереди → bucket 'failed'
 * (не ретраить автоматически). Исключения из 4xx:
 *   • 401 — сессия протухла; после re-login чек отправится сам, паркуется
 *     как pending, а не failed;
 *   • 429 — rate-limit, чисто временный.
 */
export function isPermanentServerRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
  if (status === undefined) return false;
  if (status === 401 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Русское сообщение сервера из axios-ошибки (для bucket'а 'failed'). Разбор
 * живёт в `utils/apiError.ts` — тот же порядок полей нужен всем экранам,
 * здесь отличается только fallback про чек.
 */
export function extractServerMessage(error: unknown): string {
  return extractApiErrorMessage(error, 'Сервер отклонил чек');
}

// ── Сериализация ────────────────────────────────────────────────────────────

/** Санитизация одной записи из хранилища — мусор отбрасывается молча. */
function sanitizeStoredEntry(raw: unknown): QueuedCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<QueuedCheck>;
  if (typeof entry.clientRequestId !== 'string' || !entry.clientRequestId) return null;
  if (!entry.payload || typeof entry.payload !== 'object') return null;
  const status: QueuedCheckStatus = entry.status === 'failed' ? 'failed' : 'pending';
  return {
    clientRequestId: entry.clientRequestId,
    payload: entry.payload as QueuedCheckPayload,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
    attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
    status,
    ...(typeof entry.failedMessage === 'string' ? { failedMessage: entry.failedMessage } : {}),
    ...(entry.meta && typeof entry.meta === 'object' ? { meta: entry.meta as QueuedCheckMeta } : {}),
  };
}

/**
 * Разбор сырого значения из AsyncStorage. Повреждённый JSON или чужая версия
 * схемы → пустая очередь (лучше потерять хвост при апгрейде схемы, чем крашить
 * boot; версию меняем только вместе с ключом/миграцией).
 */
export function parseStoredQueue(raw: string | null): QueuedCheck[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { v?: number; entries?: unknown[] } | null;
    if (!parsed || parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return [];
    const out: QueuedCheck[] = [];
    for (const item of parsed.entries) {
      const entry = sanitizeStoredEntry(item);
      if (entry) out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** Обратная сторона parseStoredQueue — версионированный конверт. */
export function serializeQueue(entries: readonly QueuedCheck[]): string {
  return JSON.stringify({ v: STORAGE_VERSION, entries });
}

// ── Ядро очереди (DI, тестируемое) ──────────────────────────────────────────

export interface OfflineCheckQueueCore {
  /** Гидратация из storage (идемпотентная, кешируется). */
  ensureLoaded(): Promise<void>;
  /** Текущий снапшот (стабильная ссылка между изменениями — для React). */
  getSnapshot(): readonly QueuedCheck[];
  subscribe(listener: () => void): () => void;
  /** Кол-во записей, ожидающих АВТО-отправки (без bucket'а 'failed'). */
  pendingCount(): number;
  /**
   * Поставить чек в очередь. Дубликат clientRequestId (двойной тап по ретраю)
   * молча возвращает существующую запись. При отказе ЗАПИСИ на диск бросает —
   * вызывающий экран обязан показать честную ошибку (чек в очередь НЕ попал).
   */
  enqueue(payload: QueuedCheckPayload, meta?: QueuedCheckMeta): Promise<QueuedCheck>;
  /** Полная очистка (logout/смена аккаунта — очередь не переживает пользователя). */
  clearAll(): Promise<void>;
  remove(clientRequestId: string): Promise<void>;
  /** failed → pending + немедленная попытка отправки. */
  retry(clientRequestId: string): Promise<void>;
  /** Последовательная досылка всех pending-записей. Конкурентные вызовы сливаются. */
  flush(): Promise<FlushResult>;
  /** Триггер «сеть доказуемо вернулась» — с дебаунсом, безопасно спамить. */
  kickFromNetworkSuccess(): void;
  /** Отправитель + колбэки; wiring — App.tsx (attachOfflineCheckQueue). */
  setSender(
    send: SendQueuedCheck | null,
    callbacks?: {
      onSent?: (entry: QueuedCheck, result: unknown) => void;
      onRejected?: (entry: QueuedCheck, message: string) => void;
    },
  ): void;
}

export function createOfflineCheckQueueCore(deps: OfflineCheckQueueCoreDeps): OfflineCheckQueueCore {
  const now = deps.now ?? (() => Date.now());

  let entries: readonly QueuedCheck[] = [];
  let loaded = false;
  let loadPromise: Promise<void> | null = null;
  let flushPromise: Promise<FlushResult> | null = null;
  let flushGeneration = -1;
  let lastNetworkKickAt = 0;
  // A clear is an authenticated-session boundary. Async work captured before
  // it may finish at native level, but must never publish or send in the new
  // session.
  let sessionGeneration = 0;

  // Preserve disk ordering: a slow pre-clear write must always be followed by
  // the empty clear snapshot, never complete after it and resurrect on boot.
  let storageWriteTail: Promise<void> = Promise.resolve();
  // A failed session-boundary clear leaves the old durable queue on disk.
  // Until a later clear succeeds, never persist or send new-session entries:
  // durable auth intentionally stays on the old session too, so reboot state
  // remains consistent instead of pairing token A with queue B.
  let storageBoundaryReady = true;

  let send: SendQueuedCheck | null = null;
  let onSent: ((entry: QueuedCheck, result: unknown) => void) | undefined;
  let onRejected: ((entry: QueuedCheck, message: string) => void) | undefined;

  const listeners = new Set<() => void>();

  function notify(): void {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ошибка одного подписчика не должна ронять остальных.
      }
    });
  }

  function persistSnapshot(snapshot: readonly QueuedCheck[]): Promise<void> {
    const serialized = serializeQueue(snapshot);
    const write = storageWriteTail
      .catch(() => {})
      .then(() => deps.storage.setItem(OFFLINE_CHECK_QUEUE_STORAGE_KEY, serialized));
    storageWriteTail = write.catch(() => {});
    return write;
  }

  /** Заменить снапшот (иммутабельно — для useSyncExternalStore), сохранить, оповестить. */
  async function commit(next: readonly QueuedCheck[], ownerGeneration = sessionGeneration): Promise<boolean> {
    if (ownerGeneration !== sessionGeneration) return false;
    entries = next;
    notify();
    try {
      await persistSnapshot(next);
    } catch {
      // Диск отказал ПОСЛЕ обновления памяти: очередь этой сессии живёт, при
      // рестарте вернётся последняя удачная запись. Благодаря идемпотентному
      // clientRequestId возможный повтор отправки безопасен (дубля не будет).
    }
    return ownerGeneration === sessionGeneration;
  }

  function ensureLoaded(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loadPromise) {
      const ownerGeneration = sessionGeneration;
      const pendingLoad = deps.storage
        .getItem(OFFLINE_CHECK_QUEUE_STORAGE_KEY)
        .then((raw) => {
          // A getItem started for a previous tenant may resolve after clear.
          if (ownerGeneration !== sessionGeneration) return;
          // enqueue мог отработать, пока читался диск, — не затираем свежие
          // записи гидратацией (дозаписываем восстановленные В НАЧАЛО: они старше).
          const restored = parseStoredQueue(raw);
          if (restored.length > 0) {
            const known = new Set(entries.map((e) => e.clientRequestId));
            const merged = [...restored.filter((e) => !known.has(e.clientRequestId)), ...entries];
            entries = merged;
            notify();
          }
          loaded = true;
        })
        .catch(() => {
          if (ownerGeneration !== sessionGeneration) return;
          // Не смогли прочитать диск — работаем с пустой очередью в памяти.
          loaded = true;
        })
        .finally(() => {
          if (loadPromise === pendingLoad) loadPromise = null;
        });
      loadPromise = pendingLoad;
    }
    return loadPromise;
  }

  async function enqueue(payload: QueuedCheckPayload, meta?: QueuedCheckMeta): Promise<QueuedCheck> {
    const ownerGeneration = sessionGeneration;
    await ensureLoaded();
    if (ownerGeneration !== sessionGeneration) throw new Error('Сессия сменилась до сохранения чека');
    if (!storageBoundaryReady) throw new Error('Хранилище офлайн-очереди не готово после смены сессии');
    const existing = entries.find((e) => e.clientRequestId === payload.clientRequestId);
    if (existing) return existing;
    const entry: QueuedCheck = {
      clientRequestId: payload.clientRequestId,
      payload,
      createdAt: now(),
      attempts: 0,
      status: 'pending',
      ...(meta ? { meta } : {}),
    };
    const next = [...entries, entry];
    // В отличие от commit(), здесь отказ диска ПРОБРАСЫВАЕТСЯ и память
    // откатывается: экран обязан показать честную ошибку вместо ложного
    // «чек сохранён на телефоне».
    const prev = entries;
    entries = next;
    notify();
    try {
      await persistSnapshot(next);
    } catch (err) {
      if (ownerGeneration === sessionGeneration) {
        entries = prev;
        notify();
      }
      throw err;
    }
    if (ownerGeneration !== sessionGeneration) throw new Error('Сессия сменилась до сохранения чека');
    return entry;
  }

  async function remove(clientRequestId: string): Promise<void> {
    const ownerGeneration = sessionGeneration;
    await ensureLoaded();
    if (ownerGeneration !== sessionGeneration || !storageBoundaryReady) return;
    if (!entries.some((e) => e.clientRequestId === clientRequestId)) return;
    await commit(
      entries.filter((e) => e.clientRequestId !== clientRequestId),
      ownerGeneration,
    );
  }

  async function retry(clientRequestId: string): Promise<void> {
    const ownerGeneration = sessionGeneration;
    await ensureLoaded();
    if (ownerGeneration !== sessionGeneration || !storageBoundaryReady) return;
    const target = entries.find((e) => e.clientRequestId === clientRequestId);
    if (!target || target.status !== 'failed') return;
    const committed = await commit(
      entries.map((e) =>
        e.clientRequestId === clientRequestId ? { ...e, status: 'pending' as const, failedMessage: undefined } : e,
      ),
      ownerGeneration,
    );
    if (!committed || ownerGeneration !== sessionGeneration) return;
    await flush();
  }

  async function doFlush(ownerGeneration: number): Promise<FlushResult> {
    await ensureLoaded();
    let sent = 0;
    let rejected = 0;
    if (ownerGeneration !== sessionGeneration || !storageBoundaryReady) {
      return { sent, rejected, remaining: entries.length };
    }
    if (!send) {
      // Wiring ещё не подключён (attachOfflineCheckQueue не вызван) —
      // отправлять нечем; данные никуда не деваются.
      return { sent, rejected, remaining: entries.length };
    }

    // Последовательно, по одному, в порядке добавления. 'failed' пропускаются
    // (ждут ручного «Повторить») и не блокируют последующие pending-чеки.
    for (;;) {
      if (ownerGeneration !== sessionGeneration) break;
      const entry = entries.find((e) => e.status === 'pending');
      if (!entry) break;

      // attempts++ фиксируем ДО запроса, чтобы счётчик пережил смерть
      // процесса посреди отправки.
      const attempted: QueuedCheck = { ...entry, attempts: entry.attempts + 1 };
      const committed = await commit(
        entries.map((e) => (e.clientRequestId === entry.clientRequestId ? attempted : e)),
        ownerGeneration,
      );
      if (!committed || ownerGeneration !== sessionGeneration) break;

      try {
        const result = await send(attempted.payload);
        if (ownerGeneration !== sessionGeneration) break;
        const removed = await commit(
          entries.filter((e) => e.clientRequestId !== attempted.clientRequestId),
          ownerGeneration,
        );
        if (!removed || ownerGeneration !== sessionGeneration) break;
        sent += 1;
        try {
          onSent?.(attempted, result);
        } catch {
          // Колбэк (инвалидация/уведомление) не должен останавливать очередь.
        }
      } catch (error) {
        if (ownerGeneration !== sessionGeneration) break;
        if (isPermanentServerRejection(error)) {
          const message = extractServerMessage(error);
          rejected += 1;
          const markedFailed = await commit(
            entries.map((e) =>
              e.clientRequestId === attempted.clientRequestId
                ? { ...e, status: 'failed' as const, failedMessage: message }
                : e,
            ),
            ownerGeneration,
          );
          if (!markedFailed || ownerGeneration !== sessionGeneration) break;
          try {
            onRejected?.(attempted, message);
          } catch {
            // см. выше
          }
          continue; // сервер жив — пробуем следующий чек
        }
        // Сетевой / 5xx / 401 / 429 отказ: сервер (или сессия) недоступен —
        // запись остаётся pending, раунд останавливается. Следующий триггер
        // (foreground / 60s / успех сети / вручную) попробует снова.
        break;
      }
    }

    return { sent, rejected, remaining: entries.length };
  }

  function flush(): Promise<FlushResult> {
    const ownerGeneration = sessionGeneration;
    if (flushPromise && flushGeneration === ownerGeneration) return flushPromise;
    const pendingFlush = doFlush(ownerGeneration).finally(() => {
      if (flushPromise === pendingFlush) {
        flushPromise = null;
        flushGeneration = -1;
      }
    });
    flushPromise = pendingFlush;
    flushGeneration = ownerGeneration;
    return pendingFlush;
  }

  function kickFromNetworkSuccess(): void {
    if (flushPromise) return;
    // Дешёвый sync-байл: очередь уже загружена и пуста → не трогаем диск.
    if (loaded && !entries.some((e) => e.status === 'pending')) return;
    const t = now();
    if (t - lastNetworkKickAt < NETWORK_SUCCESS_KICK_DEBOUNCE_MS) return;
    lastNetworkKickAt = t;
    void flush();
  }

  return {
    ensureLoaded,
    getSnapshot: () => entries,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pendingCount: () => entries.reduce((n, e) => (e.status === 'pending' ? n + 1 : n), 0),
    // Ревью 05.07: очередь НЕ должна переживать смену аккаунта — иначе
    // отложенный чек мастера A дослался бы под токеном мастера B (чужой
    // тенант!). Вызывается из logout; зеркалит решение web (purgeOfflineQueues).
    clearAll: async () => {
      sessionGeneration += 1;
      const ownerGeneration = sessionGeneration;
      storageBoundaryReady = false;
      entries = [];
      loaded = true;
      loadPromise = null;
      flushPromise = null;
      flushGeneration = -1;
      lastNetworkKickAt = 0;
      notify();
      await persistSnapshot([]);
      if (ownerGeneration === sessionGeneration) storageBoundaryReady = true;
    },
    enqueue,
    remove,
    retry,
    flush,
    kickFromNetworkSuccess,
    setSender: (nextSend, callbacks) => {
      send = nextSend;
      onSent = callbacks?.onSent;
      onRejected = callbacks?.onRejected;
    },
  };
}

// ── Синглтон приложения ─────────────────────────────────────────────────────
// AsyncStorage подключается ЛЕНИВЫМ require внутри геттера: top-level импорт
// протащил бы react-native в node-jest (см. шапку). В рантайме RN require
// резолвится Metro как обычно.

let singleton: OfflineCheckQueueCore | null = null;

function getQueue(): OfflineCheckQueueCore {
  if (!singleton) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage')
      .default as typeof import('@react-native-async-storage/async-storage').default;
    singleton = createOfflineCheckQueueCore({
      storage: {
        getItem: (key) => AsyncStorage.getItem(key),
        setItem: (key, value) => AsyncStorage.setItem(key, value),
      },
    });
  }
  return singleton;
}

/** См. OfflineCheckQueueCore.enqueue. Вызывается из CheckCreateScreen. */
export function enqueueOfflineCheck(payload: QueuedCheckPayload, meta?: QueuedCheckMeta): Promise<QueuedCheck> {
  return getQueue().enqueue(payload, meta);
}

/** Ручная досылка («Отправить сейчас» в Журнале). */
export function flushOfflineCheckQueue(): Promise<FlushResult> {
  return getQueue().flush();
}

/** Полная очистка очереди — вызывается из logout (см. clearAll в core). */
export function clearOfflineCheckQueue(): Promise<void> {
  return getQueue().clearAll();
}

export function removeOfflineCheck(clientRequestId: string): Promise<void> {
  return getQueue().remove(clientRequestId);
}

export function retryOfflineCheck(clientRequestId: string): Promise<void> {
  return getQueue().retry(clientRequestId);
}

/**
 * Flush-триггер «любой успешный ответ axios» — App.tsx подписывает его на
 * onRequestSucceeded. Дебаунс и no-op-гварды внутри ядра.
 */
export function kickOfflineCheckQueueOnNetworkSuccess(): void {
  getQueue().kickFromNetworkSuccess();
}

/**
 * Реактивный снапшот очереди (pending + failed) для бейджа в Журнале и
 * суффикса OfflineBanner. Ссылка стабильна между изменениями.
 */
export function useOfflineCheckQueue(): readonly QueuedCheck[] {
  const queue = getQueue();
  return useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
}

// ── Wiring (App.tsx) ───────────────────────────────────────────────────────

/** Минимальный интерфейс AppState — инжектится из App.tsx (react-native). */
export interface AppStateLike {
  currentState: string;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

export interface AttachOfflineCheckQueueOptions {
  /** Живая отправка чека (checksApi.create). */
  send: SendQueuedCheck;
  /** Успешная досылка: инвалидация query-ключей + тихое уведомление. */
  onSent?: (entry: QueuedCheck, result: unknown) => void;
  /** Детерминированный отказ сервера: одноразовый Alert с сообщением. */
  onRejected?: (entry: QueuedCheck, message: string) => void;
  /** react-native AppState (инжектится, чтобы модуль остался jest-чистым). */
  appState?: AppStateLike | null;
  /**
   * Online-статус приложения (App.tsx инжектит onlineManager из
   * @tanstack/react-query — тот же источник, что ставит queries на паузу;
   * DI по той же причине, что и appState). Возврат online при непустой
   * очереди → немедленный flush (C-5).
   */
  online?: OnlineStatusLike | null;
  /** Период фонового таймера (тестовый override). */
  flushIntervalMs?: number;
}

/** Минимальный интерфейс onlineManager: подписка на смену online-статуса. */
export interface OnlineStatusLike {
  subscribe(listener: (isOnline: boolean) => void): () => void;
}

/**
 * Подключить очередь к приложению: сендер + гидратация + стартовая досылка
 * хвоста прошлой сессии + триггеры (foreground, 60s-таймер пока непуста).
 * Возвращает cleanup. Вызывается один раз из App.tsx.
 */
export function attachOfflineCheckQueue(options: AttachOfflineCheckQueueOptions): () => void {
  const queue = getQueue();
  queue.setSender(options.send, { onSent: options.onSent, onRejected: options.onRejected });

  const intervalMs = options.flushIntervalMs ?? QUEUE_FLUSH_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let detached = false;

  // Таймер живёт ТОЛЬКО пока есть pending-записи — нулевая фоновая цена у
  // пустой очереди. Подписка ниже синхронизирует его на каждом изменении.
  const syncTimer = () => {
    if (detached) return;
    const hasPending = queue.pendingCount() > 0;
    if (hasPending && !timer) {
      timer = setInterval(() => {
        void queue.flush();
      }, intervalMs);
    } else if (!hasPending && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
  const unsubscribe = queue.subscribe(syncTimer);

  // Гидратация + стартовая досылка хвоста прошлой сессии.
  void queue
    .ensureLoaded()
    .then(() => {
      syncTimer();
      if (queue.pendingCount() > 0) return queue.flush();
      return undefined;
    })
    .catch(() => {});

  // Foreground → flush (чистый переход в 'active', как в foregroundRevalidation).
  let prevAppState = options.appState?.currentState ?? 'active';
  const appStateSub = options.appState?.addEventListener('change', (next) => {
    const cameToForeground = next === 'active' && prevAppState !== 'active';
    prevAppState = next;
    if (cameToForeground && queue.pendingCount() > 0) void queue.flush();
  });

  // Возврат сети → немедленный flush (C-5). Без этого триггера досылка после
  // reconnect ждала до 60 с (таймер) или первого успешного axios-запроса
  // где-то ещё в приложении. onlineManager дедуплицирует статус (эмитит
  // только смену), flush() сливает конкурентные вызовы — спама нет.
  const unsubscribeOnline = options.online?.subscribe((isOnline) => {
    if (isOnline && queue.pendingCount() > 0) void queue.flush();
  });

  return () => {
    detached = true;
    unsubscribe();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    appStateSub?.remove();
    unsubscribeOnline?.();
    // Сендер намеренно НЕ сбрасываем: поздний flush в полёте должен уметь
    // завершиться; повторный attach просто перезапишет его.
  };
}
