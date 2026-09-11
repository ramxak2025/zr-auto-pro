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
 * ЖИВУЧЕСТЬ (пакет «потеря данных», 2026-09). Очередь принадлежит ЧЕЛОВЕКУ, а
 * не сессии: истёкший токен, снятый доступ к филиалу, архивация филиала и
 * обычный «Выйти» её НЕ СТИРАЮТ — конверт на диске хранит владельца
 * ({@link QueueOwner}), и следующий вход либо усыновляет очередь (тот же
 * пользователь + тот же тенант → досылается), либо стирает её (за телефон сел
 * другой человек). До этого любой разлогин чистил очередь безусловно, и три
 * набитых в подвале заказ-наряда исчезали молча — ровно в тот момент, когда
 * владелец поправил мастеру доступы.
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

import { AUTH_SESSION_ENVELOPE_KEY, parseAuthSessionEnvelope } from '../contexts/authSessionStorage';
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

/**
 * ВЛАДЕЛЕЦ ОЧЕРЕДИ — «чей это набитый в офлайне заказ-наряд».
 *
 * Очередь обязана пережить ИСТЁКШИЙ ТОКЕН и обычный выход того же человека
 * (см. endSession): чек лежит на телефоне мастера, а не «в сессии». Стирать её
 * можно ровно в одном случае — за телефон сел ДРУГОЙ человек или тот же
 * человек вошёл в ДРУГОЙ автосервис; иначе досылка ушла бы под чужим токеном,
 * то есть в чужую кассу.
 */
export interface QueueOwner {
  /** users.id — кому принадлежат отложенные чеки. */
  userId: string;
  /** tenants.id — очередь никогда не переезжает в другой автосервис. null = профиль без тенанта. */
  tenantId: string | null;
}

/** Один ли это владелец. undefined/null с обеих сторон НЕ равны: неизвестный владелец не совпадает ни с кем. */
export function sameQueueOwner(a: QueueOwner | null | undefined, b: QueueOwner | null | undefined): boolean {
  if (!a || !b) return false;
  return a.userId === b.userId && (a.tenantId ?? null) === (b.tenantId ?? null);
}

function sanitizeOwner(raw: unknown): QueueOwner | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { userId?: unknown; tenantId?: unknown };
  if (typeof candidate.userId !== 'string' || !candidate.userId) return null;
  return {
    userId: candidate.userId,
    tenantId: typeof candidate.tenantId === 'string' && candidate.tenantId ? candidate.tenantId : null,
  };
}

/** Отправка одного чека на сервер (App.tsx подставляет checksApi.create). */
export type SendQueuedCheck = (payload: QueuedCheckPayload) => Promise<unknown>;

export interface OfflineCheckQueueCoreDeps {
  storage: QueueStorage;
  now?: () => number;
  /**
   * Текущий филиал пользователя (мульти-точки, 156/160) на момент постановки
   * чека в очередь. Синглтон читает его из сохранённой сессии авторизации;
   * тесты подставляют своё. Отсутствие точки = null; УПАВШИЙ резолвер тоже
   * трактуется как null (enqueue ловит отказ сам) — очередь важнее точности
   * штампа, терять офлайн-чек из-за сбоя вспомогательного чтения нельзя.
   */
  resolvePointId?: () => Promise<string | null>;
  /**
   * Владелец очереди, когда его ещё никто не объявил (холодный старт на
   * конверте старой версии, где поля owner не было). Читается из сохранённой
   * сессии авторизации — тем же способом, что resolvePointId. Падение = null:
   * чек важнее штампа, но такой конверт следующий вход уже не усыновит.
   */
  resolveOwner?: () => Promise<QueueOwner | null>;
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
  // класть НЕЛЬЗЯ: отмена приходит ровно в момент смены сессии, и запись легла
  // бы с владельцем, который уже сменился (или без него) — ложный «сохранён на
  // телефоне» превратился бы в тихую потерю чека. Экран обязан показать честную
  // ошибку.
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

/**
 * ВЛАДЕЛЕЦ из сохранённого конверта. null — конверт старой версии (поля не
 * было) либо мусор: такой очереди следующий вход не доверяет и стирает её,
 * потому что доказать «это тот же человек» уже нечем.
 */
export function parseStoredQueueOwner(raw: string | null): QueueOwner | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; owner?: unknown } | null;
    if (!parsed || parsed.v !== STORAGE_VERSION) return null;
    return sanitizeOwner(parsed.owner);
  } catch {
    return null;
  }
}

/**
 * Обратная сторона parseStoredQueue — версионированный конверт. Владелец
 * хранится НА КОНВЕРТЕ, а не в каждой записи: в один момент времени очередь
 * принадлежит ровно одной сессии, и одного штампа достаточно, чтобы следующий
 * вход мог решить «усыновить или стереть».
 */
export function serializeQueue(entries: readonly QueuedCheck[], owner?: QueueOwner | null): string {
  return JSON.stringify({ v: STORAGE_VERSION, ...(owner ? { owner } : {}), entries });
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
  /** Полная очистка диска и памяти (смена владельца). */
  clearAll(): Promise<void>;
  /**
   * ВХОД: объявить владельца текущей сессии. Записи ТОГО ЖЕ владельца
   * остаются на месте и будут досланы, записи чужого — стираются. Ждать до
   * конца обязательно: вызывающий не имеет права сохранить токен B, пока на
   * диске могла остаться очередь A.
   */
  adoptSession(owner: QueueOwner): Promise<void>;
  /**
   * ВЫХОД / ИСТЁКШИЙ ТОКЕН: закрыть сессию, НЕ ТРОГАЯ ДИСК. Память чистится
   * (экраны следующей сессии не должны видеть чужой список), но набитые в
   * офлайне чеки остаются на телефоне и ждут входа их владельца.
   */
  endSession(): Promise<void>;
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
  // Без инжекта точка не штампуется вовсе — payload остаётся прежним.
  const resolvePointId = deps.resolvePointId ?? (async () => null);
  const resolveOwner = deps.resolveOwner ?? (async () => null);

  // Владелец ТЕКУЩЕЙ очереди. Пишется на конверт при каждом сохранении, чтобы
  // следующий вход мог отличить «мои отложенные чеки» от чужих.
  let owner: QueueOwner | null = null;
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
    const serialized = serializeQueue(snapshot, owner);
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
          // Владелец с конверта — только если его ещё не объявил вход
          // (adoptSession): объявленный авторитетнее прочитанного.
          if (!owner) owner = parseStoredQueueOwner(raw);
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

    // ── ФИЛИАЛ ЧЕКА (мульти-точки 156/160) ──────────────────────────────
    // Та же болезнь, что была у ДАТЫ: сервер штампует филиал в момент, когда
    // получил запрос. Живому сабмиту это подходит (запрос = нажатие
    // «Пробить»), а вот запись из очереди может пролежать до возврата сети —
    // мастер набил чек в филиале А, доехал до Б и вошёл там в свою сессию, и
    // выручка ушла бы филиалу Б. Поэтому филиал фиксируем ЗДЕСЬ: постановка в
    // очередь происходит ровно в момент нажатия «Пробить». Филиал теперь
    // свойство сессии (163), но досылка может уйти уже из ДРУГОЙ сессии —
    // именно поэтому штамп в payload остаётся обязательным.
    //
    // Филиала нет (одноточечный тенант) — поля в payload НЕ появляется вовсе,
    // и он остаётся байт-в-байт прежним.
    // Явный pointId в payload не перетираем: если экран когда-нибудь начнёт
    // присылать точку сам, его выбор важнее нашего резолва.
    // Сервер всё равно проверит доступ автора к этой точке и при неудаче
    // молча возьмёт текущую — досылка не может ни упасть, ни увести деньги.
    //
    // ОЧЕРЕДЬ ВАЖНЕЕ ШТАМПА. Резолвер лезет в AsyncStorage (сохранённая
    // сессия), и его падение раньше пробрасывалось наружу — то есть чек,
    // набитый в офлайне, просто ТЕРЯЛСЯ из-за сбоя вспомогательного чтения.
    // Хуже поведения придумать нельзя: филиал сервер при досылке подставит
    // сам, а потерянный заказ-наряд не восстановит никто. Поэтому ошибка
    // резолвера = «точки нет»: чек встаёт в очередь без поля pointId.
    let stamped = payload;
    if (payload.pointId === undefined) {
      const pointId = await resolvePointId().catch(() => null);
      if (pointId) stamped = { ...payload, pointId };
    }

    // Владельца очереди объявляет вход (adoptSession). Сюда попадаем только на
    // конверте старой версии (обновление приложения посреди офлайн-смены):
    // дорезолвим из сохранённой сессии, иначе чек лёг бы без штампа и
    // следующий вход стёр бы его как «ничей».
    if (!owner) {
      const resolved = await resolveOwner().catch(() => null);
      if (resolved && ownerGeneration === sessionGeneration) owner = resolved;
    }

    const entry: QueuedCheck = {
      clientRequestId: stamped.clientRequestId,
      payload: stamped,
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
    // Очередь НЕ должна переживать смену ВЛАДЕЛЬЦА — иначе отложенный чек
    // мастера A дослался бы под токеном мастера B (чужая касса). Стирание диска
    // происходит ровно здесь, и зовёт его только adoptSession, когда владелец
    // не совпал.
    clearAll: async () => {
      sessionGeneration += 1;
      const ownerGeneration = sessionGeneration;
      storageBoundaryReady = false;
      owner = null;
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

    // ВХОД. Здесь решается судьба лежащих на диске чеков: тот же человек в том
    // же автосервисе — очередь остаётся и досылается; кто-то другой — стираем.
    // Раньше вход (и выход, и 401) стирали её БЕЗУСЛОВНО, и мастер, набивший
    // три заказ-наряда без связи, терял их молча, стоило токену истечь или
    // владельцу поправить ему доступ к филиалу.
    adoptSession: async (next: QueueOwner) => {
      sessionGeneration += 1;
      const ownerGeneration = sessionGeneration;
      storageBoundaryReady = false;
      owner = null;
      entries = [];
      loaded = false;
      loadPromise = null;
      flushPromise = null;
      flushGeneration = -1;
      lastNetworkKickAt = 0;
      notify();

      // Дожидаемся хвоста записей прошлой сессии: иначе прочитали бы диск до
      // её последнего сохранения и «усыновили» бы состояние без последнего чека.
      await storageWriteTail.catch(() => {});
      let restored: QueuedCheck[] = [];
      try {
        const raw = await deps.storage.getItem(OFFLINE_CHECK_QUEUE_STORAGE_KEY);
        // Конверт без владельца (старая версия схемы) доказать «это тот же
        // человек» не может — такие записи не усыновляем: тихо отправить чужой
        // чек в чужую кассу хуже, чем потерять его на обновлении приложения.
        if (sameQueueOwner(parseStoredQueueOwner(raw), next)) restored = parseStoredQueue(raw);
      } catch {
        // Диск не прочитался — считаем владельца неизвестным и начинаем с
        // пустой очереди: изоляция тенантов важнее сохранности хвоста.
        restored = [];
      }
      if (ownerGeneration !== sessionGeneration) return;

      owner = next;
      entries = restored;
      loaded = true;
      notify();
      // Конверт переписываем ВСЕГДА: так на диске появляется штамп владельца
      // (в том числе при миграции со старой схемы) и стирается чужая очередь.
      await persistSnapshot(entries);
      if (ownerGeneration === sessionGeneration) storageBoundaryReady = true;
    },

    // ВЫХОД / 401. Диск НЕ ТРОГАЕМ: чеки принадлежат человеку, а не сессии.
    // Память чистим, чтобы список прошлой сессии не светился на экране входа и
    // чтобы поздний flush не ушёл под новым токеном (sessionGeneration).
    endSession: async () => {
      sessionGeneration += 1;
      owner = null;
      entries = [];
      loaded = false;
      loadPromise = null;
      flushPromise = null;
      flushGeneration = -1;
      lastNetworkKickAt = 0;
      // storageBoundaryReady остаётся прежним: границу диска мы не двигали.
      notify();
      // Хвост записей прошлой сессии обязан долежать до диска — именно он и
      // есть те самые неотправленные чеки.
      await storageWriteTail.catch(() => {});
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

/**
 * Филиал ТЕКУЩЕЙ СЕССИИ, как его сообщил первый экран, прочитавший GET /points.
 * Приоритетнее сохранённой сессии: она обновляется только после /auth/me, а
 * очередь обязана знать филиал уже в момент первого «Пробить». null = у
 * тенанта нет живых филиалов (163) ЯВНО, undefined = «никто не сообщал» (тогда
 * читаем сессию). Сбрасывается на logout вместе с очередью — филиал прошлой
 * сессии не должен пережить вход в другой филиал.
 */
let liveCurrentPointId: string | null | undefined;

/**
 * Сообщить очереди филиал текущей сессии (зовётся из usePointsQuery, как
 * только приехал GET /points). Необязательно: без вызова очередь читает филиал
 * из сохранённой сессии авторизации.
 */
export function setOfflineCheckQueuePointId(pointId: string | null): void {
  liveCurrentPointId = pointId;
}

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
      // Филиал берём из СОХРАНЁННОЙ сессии авторизации, а не из React-стейта:
      // очередь — модуль без провайдеров, и любой её вызов (в том числе из
      // фонового flush-триггера) обязан работать без смонтированного дерева.
      // Это тот же конверт, который читает холодный старт axios, поэтому
      // значение всегда согласовано с текущим пользователем — включая
      // переключение филиала (AuthContext перезаписывает user после
      // POST /points/switch → GET /auth/me).
      // Любая ошибка чтения/разбора = null: чек важнее штампа точки, сервер
      // тогда просто возьмёт текущую точку автора, как делал раньше.
      resolvePointId: async () => {
        if (liveCurrentPointId !== undefined) return liveCurrentPointId;
        try {
          const parsed = parseAuthSessionEnvelope(await AsyncStorage.getItem(AUTH_SESSION_ENVELOPE_KEY));
          const pointId = (parsed?.user as { currentPointId?: unknown } | null | undefined)?.currentPointId;
          return typeof pointId === 'string' && pointId.length > 0 ? pointId : null;
        } catch {
          return null;
        }
      },
      // Владелец очереди из того же сохранённого конверта сессии. Нужен только
      // на конверте очереди СТАРОЙ версии (обновление приложения посреди
      // офлайн-смены): в остальных случаях владельца объявляет вход.
      resolveOwner: async () => {
        try {
          const parsed = parseAuthSessionEnvelope(await AsyncStorage.getItem(AUTH_SESSION_ENVELOPE_KEY));
          const sessionUser = parsed?.user as { id?: unknown; tenantId?: unknown } | null | undefined;
          if (!sessionUser || typeof sessionUser.id !== 'string' || !sessionUser.id) return null;
          return {
            userId: sessionUser.id,
            tenantId: typeof sessionUser.tenantId === 'string' && sessionUser.tenantId ? sessionUser.tenantId : null,
          };
        } catch {
          return null;
        }
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

/**
 * ВХОД: объявить владельца сессии. Чеки того же человека в том же автосервисе
 * остаются и будут досланы; чужие — стираются. Зовётся из AuthContext на
 * логине, на смене филиала (это тоже новый вход) и на восстановлении сессии
 * холодным стартом.
 */
export function adoptOfflineCheckQueue(owner: QueueOwner): Promise<void> {
  // Филиал прошлой сессии не должен пережить вход: резолвер точки перечитает
  // сохранённую сессию, а её уже перезаписал вход.
  liveCurrentPointId = undefined;
  return getQueue().adoptSession(owner);
}

/**
 * ВЫХОД / ИСТЁКШИЙ ТОКЕН: закрыть сессию, сохранив очередь на диске. Именно
 * здесь раньше стоял безусловный wipe — и набитые в подвале заказ-наряды
 * исчезали, стоило истечь токену или владельцу снять доступ к филиалу.
 */
export function endOfflineCheckQueueSession(): Promise<void> {
  liveCurrentPointId = undefined;
  return getQueue().endSession();
}

/**
 * Сколько чеков ждёт АВТО-отправки прямо сейчас (без bucket'а 'failed', он
 * требует ручного решения). Нужен экрану «Ещё», чтобы предупредить перед
 * выходом: неотправленный заказ-наряд — это деньги, а не «черновик».
 */
export async function pendingOfflineCheckCount(): Promise<number> {
  const queue = getQueue();
  await queue.ensureLoaded();
  return queue.pendingCount();
}

/**
 * Приписка к диалогу выхода: сколько заказ-нарядов ещё не ушло на сервер.
 * Пустая строка = очередь пуста, диалог остаётся прежним дословно.
 *
 * Чистая функция (число → текст), чтобы формулировку можно было проверить
 * тестом: это единственное место, где человеку сообщают, что на телефоне
 * лежат ЕГО деньги и что будет с ними при выходе.
 */
export function pendingChecksLogoutNotice(count: number): string {
  if (count <= 0) return '';
  // 1 заказ-наряд · 2–4 заказ-наряда · 5+ заказ-нарядов (11–14 — тоже «-ов»).
  const tail = count % 100;
  const last = count % 10;
  const plural = tail >= 11 && tail <= 14 ? 'many' : last === 1 ? 'one' : last >= 2 && last <= 4 ? 'few' : 'many';
  const noun = plural === 'one' ? 'заказ-наряд' : plural === 'few' ? 'заказ-наряда' : 'заказ-нарядов';
  const adj = plural === 'one' ? 'неотправленный' : 'неотправленных';
  return (
    `На телефоне ${count} ${adj} ${noun} — они ещё не ушли на сервер. ` +
    'Записи сохранятся и отправятся сами, когда вы снова войдёте под этим же аккаунтом. ' +
    'Вход под другим аккаунтом их удалит.'
  );
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
