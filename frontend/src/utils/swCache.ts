/**
 * Service Worker API-cache purge — cross-tenant isolation.
 *
 * The PWA service worker (`public/sw.js`) caches GET `/api` responses keyed by
 * URL ONLY, deliberately ignoring the Authorization header so that the SWR
 * cache entry is shared across requests. The trade-off: on a shared
 * browser/kiosk a leftover `/api` response from tenant A could be served to
 * tenant B for up to the cache TTL (~30s) after a logout/login.
 *
 * On logout (and defensively on a 401 hard-redirect) we therefore drop the
 * entire `autexa-api-*` Cache Storage so the next login starts clean.
 *
 * Two strategies, used together for robustness:
 *   1. Message the active SW (`CLEAR_API_CACHE`) — it owns the cache, knows the
 *      versioned name, and can also abort any in-flight `cache.put`. We await
 *      its ACK via a MessageChannel so logout can block on completion.
 *   2. Directly delete any `autexa-api*` cache from the page via the Cache
 *      Storage API — covers the case where no SW controls the page yet
 *      (first load, hard refresh, SW updating).
 */

const SW_ACK_TIMEOUT_MS = 1500;

/** Ответ SW на адресный запрос: либо данные, либо «мы его не дождались». */
type SwReply = { kind: 'reply'; data: unknown } | { kind: 'no-sw' } | { kind: 'timeout' };

function swController(): ServiceWorker | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
}

/**
 * Спросить управляющий вкладкой SW и ДОЖДАТЬСЯ ответа.
 *
 * Исход различается специально. Для очистки кешей «нет SW» и «ответил» —
 * одно и то же (чистить нечего). Для досылки офлайн-очереди перед сменой
 * филиала разница решающая: молчание означает, что недоигранные чеки могли
 * остаться, и переключаться нельзя.
 */
function askServiceWorkerFor(type: string, timeoutMs: number): Promise<SwReply> {
  return new Promise((resolve) => {
    const controller = swController();
    if (!controller) {
      resolve({ kind: 'no-sw' });
      return;
    }

    let settled = false;
    const done = (reply: SwReply) => {
      if (settled) return;
      settled = true;
      resolve(reply);
    };

    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => done({ kind: 'reply', data: e.data });
      controller.postMessage({ type }, [channel.port2]);
      // Не висим вечно, если SW так и не ответил (умер, обновляется).
      setTimeout(() => done({ kind: 'timeout' }), timeoutMs);
    } catch {
      done({ kind: 'no-sw' });
    }
  });
}

/** Send a message to the controlling SW; resolves on ACK or timeout. */
async function askServiceWorker(type: string): Promise<void> {
  await askServiceWorkerFor(type, SW_ACK_TIMEOUT_MS);
}

/** Delete every Autexa API cache directly via the Cache Storage API. */
async function deleteApiCachesDirectly(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('autexa-api')).map((k) => caches.delete(k)));
  } catch {
    // best-effort
  }
}

/**
 * Purge all cached `/api` responses from the service worker. Best-effort and
 * safe to call when no SW / Cache Storage exists. Resolves once both the SW
 * ACK (or timeout) and the direct deletion have completed.
 */
export async function purgeApiCache(): Promise<void> {
  await Promise.all([askServiceWorker('CLEAR_API_CACHE'), deleteApiCachesDirectly()]);
}

// ─── Offline mutation queue purge (logout / session change) ──────────────────
//
// The SW keeps unsent POST/PATCH/DELETE mutations in IndexedDB `autexa-sw`
// (stores: pending queue + failed archive). On replay the SW attaches the
// CURRENT session's token (records don't carry Authorization since SW v14),
// so a queue left over from user A would be replayed under user B's token —
// a write into the wrong tenant. Both stores must therefore die with the
// session, same two-pronged strategy as the API cache above.

const SW_IDB_NAME = 'autexa-sw';
const SW_QUEUE_STORE = 'autexa-offline-queue';
const SW_FAILED_STORE = 'autexa-offline-failed';
const SW_IDB_STORES = [SW_QUEUE_STORE, SW_FAILED_STORE];

/**
 * Открыть базу SW из страницы БЕЗ указания версии — схема принадлежит SW, и
 * апгрейдить её отсюда нельзя ни при каких обстоятельствах.
 *
 * Если базы ещё нет, открывать её не надо вовсе: пустая оболочка v1 без сторов
 * заставит SW делать upgrade, а пока наша вкладка держит соединение, upgrade
 * ЗАБЛОКИРОВАН — то есть досылка очереди повиснет. Поэтому там, где браузер
 * умеет `databases()`, сначала спрашиваем, существует ли база. Соединение
 * закрывает вызывающий (`db.close()`) — держать его открытым нельзя по той же
 * причине.
 */
async function openSwDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases().catch(() => null);
      if (list && !list.some((d) => d.name === SW_IDB_NAME)) return null;
    }
    return await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open(SW_IDB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Сколько записей в сторе. Нет стора / отказ чтения → 0 (best-effort). */
function countStore(db: IDBDatabase, storeName: string): Promise<number> {
  if (!db.objectStoreNames.contains(storeName)) return Promise.resolve(0);
  return new Promise((resolve) => {
    try {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).count();
      req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * СКОЛЬКО НЕОТПРАВЛЕННОГО ЛЕЖИТ НА ЭТОМ УСТРОЙСТВЕ.
 *
 *   • `pending` — записи, которые SW ещё будет отправлять. Именно они уедут в
 *     ЧУЖОЙ филиал, если сменить сессию, не доиграв очередь: Authorization в
 *     записи не хранится, и replay возьмёт токен той сессии, что будет живой;
 *   • `failed`  — архив отклонённых сервером. Автоматически НЕ переигрывается,
 *      поэтому в чужой филиал попасть не может, но это несохранённые деньги, и
 *      молчать о них после неудачной досылки нельзя.
 *
 * Чтение best-effort: отказ диска не должен ЗАПРЕЩАТЬ действие — он вернёт
 * нули, и дальше сработает обычная защита (досылка + проверка остатка).
 */
export interface OfflineQueueState {
  pending: number;
  failed: number;
}

export async function readOfflineQueueState(): Promise<OfflineQueueState> {
  const db = await openSwDb();
  if (!db) return { pending: 0, failed: 0 };
  try {
    const pending = await countStore(db, SW_QUEUE_STORE);
    const failed = await countStore(db, SW_FAILED_STORE);
    return { pending, failed };
  } catch {
    return { pending: 0, failed: 0 };
  } finally {
    db.close();
  }
}

/**
 * ЧЕМ КОНЧИЛАСЬ ПРИНУДИТЕЛЬНАЯ ДОСЫЛКА ОЧЕРЕДИ.
 *
 * `no-sw` и `timeout` — это НЕ «всё хорошо». Мы не знаем, что осталось в
 * очереди, а значит не имеем права менять сессию: цена ошибки — чек, ушедший в
 * другой автосервис.
 */
export type OfflineQueueFlush =
  | { status: 'flushed'; pending: number; failed: number }
  /** Вкладкой не управляет SW (первая загрузка, обновление, отключён). */
  | { status: 'no-sw' }
  /** SW не ответил в отведённое время — досылка, возможно, ещё идёт. */
  | { status: 'timeout' }
  /** SW ответил, но сам механизм отказал (IndexedDB недоступна). */
  | { status: 'error' };

// Досылка — это реальные сетевые запросы (по одному, последовательно), поэтому
// окно ожидания несопоставимо с ACK на очистку кеша. 30 с хватает на несколько
// чеков по плохой связи; дольше ждать нельзя — человек стоит у экрана.
const SW_FLUSH_TIMEOUT_MS = 30_000;

/**
 * Попросить SW ДОИГРАТЬ офлайн-очередь прямо сейчас и дождаться остатка.
 *
 * Зовётся ровно перед перевыпуском сессии (смена филиала): пока токен текущего
 * филиала жив, записи уходят в тот автосервис, где их пробили.
 */
export async function flushOfflineQueue(): Promise<OfflineQueueFlush> {
  const reply = await askServiceWorkerFor('FLUSH_OFFLINE_QUEUE', SW_FLUSH_TIMEOUT_MS);
  if (reply.kind === 'no-sw') return { status: 'no-sw' };
  if (reply.kind === 'timeout') return { status: 'timeout' };

  const data = reply.data as { ok?: unknown; pending?: unknown; failed?: unknown } | null;
  if (!data || data.ok !== true || typeof data.pending !== 'number' || typeof data.failed !== 'number') {
    return { status: 'error' };
  }
  return { status: 'flushed', pending: data.pending, failed: data.failed };
}

/** Clear the SW queue stores directly from the page (works with no SW too). */
async function clearOfflineStoresDirectly(): Promise<void> {
  const db = await openSwDb();
  if (!db) return;
  try {
    const stores = SW_IDB_STORES.filter((s) => db.objectStoreNames.contains(s));
    if (stores.length > 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach((s) => tx.objectStore(s).clear());
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }
  } catch {
    // best-effort
  } finally {
    // Соединение закрываем ВСЕГДА: открытая из страницы база блокирует
    // upgrade, который SW делает при следующем старте.
    db.close();
  }
}

/**
 * Purge the SW offline-mutation queue AND the failed-mutation archive.
 * Call on every session teardown (logout, hard 401 redirect) and defensively
 * before a new login. Best-effort, resolves once both paths complete.
 */
export async function purgeOfflineQueues(): Promise<void> {
  await Promise.all([askServiceWorker('CLEAR_OFFLINE_QUEUE'), clearOfflineStoresDirectly()]);
}
