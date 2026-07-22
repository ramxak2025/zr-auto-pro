// ═══════════════════════════════════════════════════════════════════════════════
//  Autexa PWA Service Worker v15
//
//  SPEED STRATEGY:
//  - GET /api/auth/* → bypass SW, always network (auth must be fresh)
//  - GET /api/*      → network-first (fresh data always; Cache Storage —
//                       ТОЛЬКО офлайн-фолбэк). Cache key = URL only, ignoring
//                       Authorization header so Vary doesn't break matching.
//  - POST/PATCH/DELETE /api/* → network, offline queue fallback
//  - Static assets   → cache-first (immutable hashed filenames)
//  - Navigation HTML  → network-first, offline fallback to cached shell
//
//  v15 — API-GET: network-first вместо stale-while-revalidate. SWR отдавал
//  закэшированный ответ ЛЮБОГО возраста, свежий доезжал только до Cache
//  Storage — refetch после invalidateQueries получал ДО-мутационный список,
//  React Query был всегда на один fetch позади (класс жалоб «не вижу
//  изменений» / stale-client). Теперь свежесть гарантирует сеть; кэш
//  используется только когда сети нет.
//
//  v14 — надёжность офлайн-очереди (финансовые операции не теряются молча):
//  - replay: успех = ТОЛЬКО 2xx. Детерминированные отказы (4xx кроме 408/429)
//    переносятся в failed-store и о них сообщается клиенту — раньше любой
//    статус <500 молча удалялся из очереди и засчитывался «отправленным».
//  - 5xx / 408 / 429 остаются в очереди с backoff-счётчиком (MAX_REPLAY_ATTEMPTS,
//    затем — в failed-store с уведомлением). Обрыв сети останавливает цикл,
//    не сжигая попытки.
//  - Authorization больше НЕ хранится в записи очереди: на replay берём свежий
//    токен у живой вкладки (GET_AUTH_TOKEN через MessageChannel). Нет вкладки /
//    нет токена → записи ждут следующего открытия (нормально для PWA).
//  - offline-GET без кэша → 503 {"offline":true} вместо 200 '[]', чтобы React
//    Query показал штатную ошибку и не закэшировал «пустой склад» как успех.
//  - CLEAR_OFFLINE_QUEUE (logout): чистит и очередь, и failed-store.
//  - Записи старого формата (v13: с authorization, без attempts) мигрируются
//    прозрачно — auth отбрасывается на replay, attempts считается от 0.
//    Ничего не дропается.
// ═══════════════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'autexa-static-v15';
const API_CACHE = 'autexa-api-v15';
const OFFLINE_QUEUE = 'autexa-offline-queue';
const FAILED_STORE = 'autexa-offline-failed';
const IDB_VERSION = 2; // v2: + FAILED_STORE

// Retriable-отказ (5xx/408/429) жжёт попытку; после MAX запись уходит в
// failed-store — иначе вечный ретрай заведомо мёртвой операции скрывал бы
// проблему от пользователя.
const MAX_REPLAY_ATTEMPTS = 5;

const PRECACHE_ASSETS = ['/', '/logo-icon.png', '/logo.png'];

// ─── Install ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ─── Activate: clean ALL old caches ──────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // ── API ──
  if (url.pathname.startsWith('/api')) {
    // Auth: always bypass — must never get stale auth data
    if (url.pathname.startsWith('/api/auth')) return;

    // Mutations: network with offline queue
    if (request.method !== 'GET') {
      event.respondWith(networkWithOfflineQueue(request));
      return;
    }

    // GET /api: network-first — сеть даёт свежие данные, кэш только офлайн
    event.respondWith(apiNetworkFirst(url.href, request));
    return;
  }

  // ── Navigation HTML ──
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((r) => {
          if (r.ok) caches.open(STATIC_CACHE).then((c) => c.put('/', r.clone()));
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // ── Static assets ──
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

// ─── API: Network-First (cache = offline fallback only) ──────────────────────
//
// Key insight: cache.match() by URL string (not Request object) so that
// Authorization / Vary headers don't break matching. Every logged-in user
// shares the same URL cache entry — React Query handles per-user data
// separation at the app level.
//
// Почему НЕ stale-while-revalidate: SWR отдавал кэш ЛЮБОГО возраста, а
// свежий ответ клал только в Cache Storage — refetch после мутации
// (invalidateQueries) получал до-мутационные данные, и UI отставал на цикл
// (до staleTime 2 мин или перезагрузки). Мгновенность UI обеспечивают
// placeholderData + persist на уровне React Query, а не SW.
//
// Flow:
//   1. Network OK → cache by URL, return fresh
//   2. Network fail + cache → return stale cache (offline, any age)
//   3. Network fail + no cache → honest 503 (axios rejects, RQ shows error)

async function apiNetworkFirst(urlHref, request) {
  const cache = await caches.open(API_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Store by URL string so future matches ignore headers
      cache.put(urlHref, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // Сеть недоступна — офлайн-фолбэк из кэша (любого возраста).
    const cached = await cache.match(urlHref);
    if (cached) return cached;

    // Offline and no cache — честная 503-ошибка. Раньше тут возвращался
    // 200 '[]': axios считал его успехом, React Query кэшировал «пустой список»
    // (склад/журнал/клиенты «обнулялись»), а persist-снапшот отравлялся до
    // следующего успешного рефетча. 503 → reject → штатный error-state.
    return new Response(JSON.stringify({ offline: true, message: 'Нет сети' }), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json', 'X-Offline': 'true' },
    });
  }
}

// ─── Static: Cache-First ─────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const c = await caches.open(STATIC_CACHE);
      c.put(request, response.clone());
    }
    return response;
  } catch {
    if (cached) return cached;
    return caches.match('/');
  }
}

// ─── Mutations: Network with Offline Queue ───────────────────────────────────

async function networkWithOfflineQueue(request) {
  try {
    return await fetch(request.clone());
  } catch (err) {
    if (request.method !== 'GET') {
      try {
        await queueMutation(request);
        notifyClients({ type: 'MUTATION_QUEUED', url: request.url, method: request.method });
        return new Response(
          JSON.stringify({ message: 'Сохранено. Будет отправлено при восстановлении сети.', queued: true }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      } catch { throw err; }
    }
    throw err;
  }
}

// ─── Offline Mutation Queue ──────────────────────────────────────────────────

async function queueMutation(request) {
  const body = await request.clone().text();
  // Headers API отдаёт ключи в lowercase — 'authorization' гарантированно
  // ловится. Токен НЕ сохраняем: запись может пролежать часы/дни, а протухший
  // Bearer в IndexedDB — это и утечка, и гарантированный 401 на replay.
  // Свежий токен запрашивается у живой вкладки в момент replay.
  const headers = Object.fromEntries(request.headers.entries());
  delete headers.authorization;

  const db = await openDB();
  await idbWrite(db, OFFLINE_QUEUE, (store) =>
    store.add({
      url: request.url,
      method: request.method,
      headers,
      body,
      timestamp: Date.now(),
      attempts: 0,
    })
  );
  if (self.registration?.sync) {
    try { await self.registration.sync.register('replay-mutations'); } catch {}
  }
}

// ONLINE-message и Background Sync могут выстрелить одновременно — без guard'а
// очередь проигрывалась бы дважды параллельно (двойные POST'ы).
let replayInFlight = false;

async function replayMutations() {
  if (replayInFlight) return;
  replayInFlight = true;
  try {
    await doReplayMutations();
  } finally {
    replayInFlight = false;
  }
}

async function doReplayMutations() {
  const db = await openDB();
  const keys = await idbRead(db, OFFLINE_QUEUE, (store) => store.getAllKeys());
  if (!keys || keys.length === 0) return;

  // Свежий токен у живой вкладки. Нет вкладки или пользователь разлогинен →
  // записи ждут следующего открытия приложения (нормальный PWA-сценарий);
  // replay без валидного токена лишь сжёг бы попытки на гарантированных 401.
  const token = await getFreshAuthToken();
  if (!token) return;

  let replayed = 0;
  let failed = 0;

  for (const key of keys) {
    const mutation = await idbRead(db, OFFLINE_QUEUE, (store) => store.get(key));
    if (!mutation) continue;

    // Записи v13 хранили authorization — отбрасываем и подставляем свежий.
    const headers = { ...(mutation.headers || {}) };
    delete headers.authorization;
    headers.authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(mutation.url, {
        method: mutation.method,
        headers,
        body: mutation.body || undefined,
      });
    } catch {
      // Сеть снова упала — стоп без сжигания попыток, дождёмся следующего ONLINE.
      break;
    }

    // Успех — ТОЛЬКО 2xx. Раньше любой статус <500 (400/401/403/409/429)
    // молча удалял запись и попадал в счётчик «Отправлено N операций».
    if (res.ok) {
      await idbWrite(db, OFFLINE_QUEUE, (store) => store.delete(key));
      replayed++;
      continue;
    }

    const retriable = res.status >= 500 || res.status === 408 || res.status === 429;
    if (!retriable) {
      // Детерминированный отказ (400/401/403/409/422/…): сервер этот payload
      // не примет никогда. 401 тоже сюда: токен был СВЕЖИЙ из живой вкладки,
      // а web-сессия не умеет обновляться без relogin (relogin чистит очередь) —
      // пути к успеху нет. НЕ удаляем молча: переносим в failed-store
      // (данные восстановимы: DevTools → IndexedDB → autexa-sw) и сообщаем.
      await moveToFailed(db, key, mutation, `HTTP ${res.status}`);
      failed++;
      continue;
    }

    // Retriable (5xx/408/429): запись остаётся в очереди на следующий цикл.
    const attempts = (mutation.attempts || 0) + 1;
    if (attempts >= MAX_REPLAY_ATTEMPTS) {
      await moveToFailed(db, key, mutation, `HTTP ${res.status} после ${attempts} попыток`);
      failed++;
    } else {
      await idbWrite(db, OFFLINE_QUEUE, (store) => store.put({ ...mutation, attempts }, key));
    }
  }

  if (replayed > 0 || failed > 0) {
    notifyClients({ type: 'MUTATIONS_REPLAYED', count: replayed, failed });
  }
}

// Порядок «add в failed → delete из queue» осознанный: если SW умрёт между
// операциями, получим дубль записи (безопасно), а не молчаливую потерю.
async function moveToFailed(db, key, mutation, reason) {
  await idbWrite(db, FAILED_STORE, (store) =>
    store.add({ ...mutation, failedAt: Date.now(), reason })
  );
  await idbWrite(db, OFFLINE_QUEUE, (store) => store.delete(key));
}

async function clearOfflineStores() {
  const db = await openDB();
  await idbWrite(db, OFFLINE_QUEUE, (store) => store.clear());
  await idbWrite(db, FAILED_STORE, (store) => store.clear());
}

// ─── Fresh auth token from a live tab ────────────────────────────────────────

function requestTokenFromClient(client) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => done(e.data && e.data.token ? e.data.token : null);
      client.postMessage({ type: 'GET_AUTH_TOKEN' }, [channel.port2]);
      setTimeout(() => done(null), 1000);
    } catch {
      done(null);
    }
  });
}

async function getFreshAuthToken() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    const token = await requestTokenFromClient(client);
    if (token) return token;
  }
  return null;
}

// ─── Events ──────────────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-mutations') event.waitUntil(replayMutations());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONLINE') replayMutations();

  // Cross-tenant isolation: on logout / session change the client asks the SW
  // to drop every cached /api response. The API cache is keyed by URL only
  // (ignoring Authorization), so a leftover entry would otherwise be served to
  // the NEXT user on a shared browser/kiosk. We fully delete & recreate the
  // API cache so no stale tenant-A payload survives the next login.
  if (event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(
      caches.delete(API_CACHE).then(() => {
        // ACK so the client can await completion before login proceeds.
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ type: 'API_CACHE_CLEARED' });
        }
      })
    );
  }

  // Logout / смена сессии: невыполненные мутации предыдущего пользователя
  // нельзя ни хранить, ни (тем более) переигрывать под токеном следующего —
  // это запись в чужой тенант. Чистим и очередь, и failed-store.
  if (event.data?.type === 'CLEAR_OFFLINE_QUEUE') {
    event.waitUntil(
      clearOfflineStores()
        .catch(() => {})
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ type: 'OFFLINE_QUEUE_CLEARED' });
          }
        })
    );
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStaticAsset(p) {
  return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif)(\?.*)?$/.test(p);
}

// Одно кэшированное соединение на инстанс SW (вместо соединения на операцию):
// не копим утёкшие коннекты, не блокируем future-апгрейды версии БД.
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('autexa-sw', IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Идемпотентно: v1→v2 добавляет FAILED_STORE, существующая очередь
      // (записи старого формата) сохраняется как есть.
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE))
        db.createObjectStore(OFFLINE_QUEUE, { autoIncrement: true });
      if (!db.objectStoreNames.contains(FAILED_STORE))
        db.createObjectStore(FAILED_STORE, { autoIncrement: true });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// Читающая операция: резолвится результатом request'а.
function idbRead(db, storeName, op) {
  return new Promise((resolve, reject) => {
    const request = op(db.transaction(storeName, 'readonly').objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Пишущая операция: резолвится ПОСЛЕ commit'а транзакции (durability —
// финансовые записи не должны теряться из-за смерти SW до фиксации).
function idbWrite(db, storeName, op) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    op(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
}
