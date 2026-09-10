/**
 * offlineCheckQueue — тесты ядра офлайн-очереди чеков (Round 9).
 *
 * Ядро dependency-injected (см. модуль), поэтому здесь всё детерминированно:
 * in-memory storage, фейковый sender, инжектированное время. Покрываем ровно
 * контракт надёжности:
 *   • генерация clientRequestId (формат UUID v4 lowercase, уникальность,
 *     Math.random-фолбэк);
 *   • классификация ошибок (что уходит в очередь, что — нет);
 *   • сериализация (round-trip, мусор, чужая версия схемы);
 *   • flush: успех → запись удалена; сеть → осталась pending и раунд
 *     остановлен; 4xx → bucket 'failed' без автопoвторов; 401/429 → pending;
 *   • retry/remove/dedupe/дебаунс сетевого kick'а.
 */
import {
  OFFLINE_CHECK_QUEUE_STORAGE_KEY,
  NETWORK_SUCCESS_KICK_DEBOUNCE_MS,
  createOfflineCheckQueueCore,
  extractServerMessage,
  generateClientRequestId,
  isNetworkClassCheckError,
  isPermanentServerRejection,
  isValidClientRequestId,
  parseStoredQueue,
  serializeQueue,
  uuidV4FromRandom,
  type QueuedCheck,
  type QueuedCheckPayload,
  type QueueStorage,
} from '../offlineCheckQueue';

// ── Хелперы ────────────────────────────────────────────────────────────────

function createMemoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  const storage: QueueStorage = {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function payloadOf(id: string, extra?: Record<string, unknown>): QueuedCheckPayload {
  return { clientRequestId: id, masterId: 'm1', services: [], products: [], ...extra };
}

function axiosError(status?: number, data?: unknown): unknown {
  if (status === undefined) {
    // Обёрнутая axios-ошибка соединения (см. api/axios.ts): без .response.
    const err = new Error('Нет соединения с сервером');
    (err as { code?: string }).code = 'ECONNABORTED';
    return err;
  }
  return { response: { status, data }, message: `Request failed with status code ${status}` };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-9222-222222222222';
const ID_C = '33333333-3333-4333-a333-333333333333';

// ── clientRequestId ────────────────────────────────────────────────────────

describe('generateClientRequestId', () => {
  it('выдаёт валидный lowercase UUID v4', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateClientRequestId();
      expect(isValidClientRequestId(id)).toBe(true);
      expect(id).toBe(id.toLowerCase());
    }
  });

  it('уникален между вызовами', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateClientRequestId());
    expect(seen.size).toBe(200);
  });

  it('Math.random-фолбэк даёт корректные version/variant биты', () => {
    // Худший RNG (все нули) обязан дать version=4 и variant=8.
    expect(uuidV4FromRandom(() => 0)).toBe('00000000-0000-4000-8000-000000000000');
    // Почти-единица — версия и вариант всё равно зажаты маской.
    const high = uuidV4FromRandom(() => 0.999999);
    expect(isValidClientRequestId(high)).toBe(true);
    // Обычный Math.random — валиден и уникален.
    const a = uuidV4FromRandom();
    const b = uuidV4FromRandom();
    expect(isValidClientRequestId(a)).toBe(true);
    expect(isValidClientRequestId(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});

// ── Классификация ошибок ───────────────────────────────────────────────────

describe('isNetworkClassCheckError (что уходит в очередь)', () => {
  it('нет ответа (timeout / DNS / offline / обёрнутая ошибка) → сетевая', () => {
    expect(isNetworkClassCheckError(axiosError(undefined))).toBe(true);
    expect(isNetworkClassCheckError(new Error('boom'))).toBe(true);
  });

  it('шлюзовые 502/503/504 → сетевые', () => {
    expect(isNetworkClassCheckError(axiosError(502))).toBe(true);
    expect(isNetworkClassCheckError(axiosError(503))).toBe(true);
    expect(isNetworkClassCheckError(axiosError(504))).toBe(true);
  });

  it('детерминированные 4xx и обычный 500 НИКОГДА не уходят в очередь', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
      expect(isNetworkClassCheckError(axiosError(status))).toBe(false);
    }
  });

  it('отмена (ERR_CANCELED / staleAuthCancellation) — детерминированная, в очередь НЕ уходит', () => {
    // Форма staleAuthCancellation из api/axios.ts: isAxiosError + ERR_CANCELED
    // + __CANCEL__, без .response. Ложное «сохранён на телефоне» здесь стало
    // бы тихой потерей чека: очередь чистится при следующем логине.
    const staleAuth = Object.assign(new Error('Request belongs to a stale auth session'), {
      isAxiosError: true,
      code: 'ERR_CANCELED',
      __CANCEL__: true,
    });
    expect(isNetworkClassCheckError(staleAuth)).toBe(false);
    // axios CanceledError несёт флаг через прототип — достаточно любого из двух.
    expect(isNetworkClassCheckError({ code: 'ERR_CANCELED' })).toBe(false);
    expect(isNetworkClassCheckError({ __CANCEL__: true })).toBe(false);
  });
});

describe('isPermanentServerRejection (flush → bucket failed)', () => {
  it('4xx кроме 401/429 — постоянный отказ', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(isPermanentServerRejection(axiosError(status))).toBe(true);
    }
  });

  it('401 (протухшая сессия) и 429 (rate-limit) — временные', () => {
    expect(isPermanentServerRejection(axiosError(401))).toBe(false);
    expect(isPermanentServerRejection(axiosError(429))).toBe(false);
  });

  it('сеть и 5xx — временные', () => {
    expect(isPermanentServerRejection(axiosError(undefined))).toBe(false);
    expect(isPermanentServerRejection(axiosError(500))).toBe(false);
    expect(isPermanentServerRejection(axiosError(502))).toBe(false);
  });
});

describe('extractServerMessage', () => {
  it('берёт message сервера (строка и массив class-validator)', () => {
    expect(extractServerMessage(axiosError(400, { message: 'Не хватает на складе' }))).toBe('Не хватает на складе');
    expect(extractServerMessage(axiosError(400, { message: ['a', 'b'] }))).toBe('a\nb');
  });

  it('фолбэки: data-строка → error → err.message → заглушка', () => {
    expect(extractServerMessage(axiosError(400, 'голый текст'))).toBe('голый текст');
    expect(extractServerMessage(axiosError(400, { error: 'Bad Request' }))).toBe('Bad Request');
    expect(extractServerMessage(axiosError(400, {}))).toBe('Request failed with status code 400');
    expect(extractServerMessage({})).toBe('Сервер отклонил чек');
  });
});

// ── Сериализация ───────────────────────────────────────────────────────────

describe('сериализация очереди', () => {
  const entry: QueuedCheck = {
    clientRequestId: ID_A,
    payload: payloadOf(ID_A, { comment: 'кириллица · ₽' }),
    createdAt: 1750000000000,
    attempts: 2,
    status: 'failed',
    failedMessage: 'Мастер не найден',
    meta: { total: 4500, clientName: 'Иванов', carInfo: 'Приора · А123ВС 05' },
  };

  it('round-trip сохраняет запись байт-в-байт по смыслу', () => {
    const restored = parseStoredQueue(serializeQueue([entry]));
    expect(restored).toEqual([entry]);
  });

  it('мусор, null и повреждённый JSON → пустая очередь (не краш)', () => {
    expect(parseStoredQueue(null)).toEqual([]);
    expect(parseStoredQueue('')).toEqual([]);
    expect(parseStoredQueue('{oops')).toEqual([]);
    expect(parseStoredQueue('42')).toEqual([]);
    expect(parseStoredQueue('{"entries":"nope","v":1}')).toEqual([]);
  });

  it('чужая версия схемы отбрасывается', () => {
    expect(parseStoredQueue(JSON.stringify({ v: 999, entries: [entry] }))).toEqual([]);
  });

  it('битые записи внутри массива отбрасываются поштучно', () => {
    const raw = JSON.stringify({ v: 1, entries: [entry, { clientRequestId: 42 }, null, { payload: {} }] });
    expect(parseStoredQueue(raw)).toEqual([entry]);
  });
});

// ── Ядро: enqueue / flush / retry / remove ─────────────────────────────────

describe('ядро очереди', () => {
  it('enqueue пишет версионированную запись в storage и в снапшот', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage, now: () => 1000 });

    const entry = await core.enqueue(payloadOf(ID_A), { total: 900, clientName: 'Пётр' });
    expect(entry).toMatchObject({ clientRequestId: ID_A, status: 'pending', attempts: 0, createdAt: 1000 });
    expect(core.getSnapshot()).toHaveLength(1);
    expect(core.pendingCount()).toBe(1);

    const raw = map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(parseStoredQueue(raw!)).toEqual([entry]);
  });

  it('enqueue дедуплицирует по clientRequestId', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));
    await core.enqueue(payloadOf(ID_A));
    expect(core.getSnapshot()).toHaveLength(1);
  });

  it('гидратация восстанавливает очередь прошлой сессии', async () => {
    const stored: QueuedCheck = {
      clientRequestId: ID_A,
      payload: payloadOf(ID_A),
      createdAt: 5,
      attempts: 1,
      status: 'pending',
    };
    const { storage } = createMemoryStorage({
      [OFFLINE_CHECK_QUEUE_STORAGE_KEY]: serializeQueue([stored]),
    });
    const core = createOfflineCheckQueueCore({ storage });
    await core.ensureLoaded();
    expect(core.getSnapshot()).toEqual([stored]);
  });

  it('flush: успех удаляет запись, зовёт onSent и чистит storage', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    const sendLog: string[] = [];
    const sentEvents: Array<{ entry: QueuedCheck; result: unknown }> = [];
    core.setSender(
      async (payload) => {
        sendLog.push(payload.clientRequestId);
        return { id: 'srv-' + payload.clientRequestId, number: 77 };
      },
      { onSent: (entry, result) => sentEvents.push({ entry, result }) },
    );

    await core.enqueue(payloadOf(ID_A));
    await core.enqueue(payloadOf(ID_B));
    const result = await core.flush();

    expect(result).toEqual({ sent: 2, rejected: 0, remaining: 0 });
    // Последовательно и в порядке добавления.
    expect(sendLog).toEqual([ID_A, ID_B]);
    expect(core.getSnapshot()).toHaveLength(0);
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null)).toEqual([]);
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[0].result).toEqual({ id: 'srv-' + ID_A, number: 77 });
    // payload досылается ТОТ ЖЕ, с тем же идемпотентным ключом.
    expect(sentEvents[0].entry.payload.clientRequestId).toBe(ID_A);
  });

  it('flush: сетевой отказ оставляет запись pending и останавливает раунд', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    let calls = 0;
    core.setSender(async () => {
      calls += 1;
      throw axiosError(undefined);
    });

    await core.enqueue(payloadOf(ID_A));
    await core.enqueue(payloadOf(ID_B));
    const result = await core.flush();

    // Первый упал по сети → второй даже не пробуем (порядок сохраняется).
    expect(calls).toBe(1);
    expect(result).toEqual({ sent: 0, rejected: 0, remaining: 2 });
    const [first, second] = core.getSnapshot();
    expect(first).toMatchObject({ clientRequestId: ID_A, status: 'pending', attempts: 1 });
    expect(second).toMatchObject({ clientRequestId: ID_B, status: 'pending', attempts: 0 });
  });

  it('flush: 5xx (обычный 500) тоже остаётся pending — идемпотентный ключ делает повтор безопасным', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    core.setSender(async () => {
      throw axiosError(500, { message: 'Internal server error' });
    });
    await core.enqueue(payloadOf(ID_A));
    const result = await core.flush();
    expect(result).toEqual({ sent: 0, rejected: 0, remaining: 1 });
    expect(core.getSnapshot()[0].status).toBe('pending');
  });

  it('flush: 4xx НЕ ретраится — запись уезжает в bucket failed с сообщением сервера, очередь идёт дальше', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    const rejections: string[] = [];
    let calls = 0;
    core.setSender(
      async (payload) => {
        calls += 1;
        if (payload.clientRequestId === ID_A) {
          throw axiosError(422, { message: 'Мастер уволен' });
        }
        return { number: 5 };
      },
      { onRejected: (_entry, message) => rejections.push(message) },
    );

    await core.enqueue(payloadOf(ID_A));
    await core.enqueue(payloadOf(ID_B));
    const result = await core.flush();

    // Отклонённый НЕ блокирует следующий pending-чек.
    expect(calls).toBe(2);
    expect(result).toEqual({ sent: 1, rejected: 1, remaining: 1 });
    const failed = core.getSnapshot()[0];
    expect(failed).toMatchObject({ clientRequestId: ID_A, status: 'failed', failedMessage: 'Мастер уволен' });
    expect(rejections).toEqual(['Мастер уволен']);

    // Повторный flush failed-запись НЕ трогает (никаких вечных ретраев 4xx).
    const again = await core.flush();
    expect(calls).toBe(2);
    expect(again).toEqual({ sent: 0, rejected: 0, remaining: 1 });
  });

  it('flush: 401 остаётся pending (после re-login чек уйдёт сам)', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    core.setSender(async () => {
      throw axiosError(401, { message: 'Unauthorized' });
    });
    await core.enqueue(payloadOf(ID_A));
    await core.flush();
    expect(core.getSnapshot()[0].status).toBe('pending');
  });

  it('retry: failed → pending и немедленная повторная отправка', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    let failOnce = true;
    core.setSender(async () => {
      if (failOnce) {
        failOnce = false;
        throw axiosError(409, { message: 'Дубликат' });
      }
      return { number: 9 };
    });

    await core.enqueue(payloadOf(ID_A));
    await core.flush();
    expect(core.getSnapshot()[0].status).toBe('failed');

    await core.retry(ID_A);
    expect(core.getSnapshot()).toHaveLength(0); // отправился и удалился
  });

  it('remove удаляет запись безвозвратно (и из storage)', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));
    await core.enqueue(payloadOf(ID_C));
    await core.remove(ID_A);
    expect(core.getSnapshot().map((e) => e.clientRequestId)).toEqual([ID_C]);
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null).map((e) => e.clientRequestId)).toEqual([
      ID_C,
    ]);
  });

  it('enqueue пробрасывает отказ диска и откатывает память (чек НЕ считается сохранённым)', async () => {
    const storage: QueueStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full');
      },
    };
    const core = createOfflineCheckQueueCore({ storage });
    await expect(core.enqueue(payloadOf(ID_A))).rejects.toThrow('disk full');
    expect(core.getSnapshot()).toHaveLength(0);
  });

  it('kickFromNetworkSuccess: дебаунс — волна успешных ответов не спамит flush', async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const { storage } = createMemoryStorage();
    let t = 100_000;
    const core = createOfflineCheckQueueCore({ storage, now: () => t });
    let calls = 0;
    core.setSender(async () => {
      calls += 1;
      throw axiosError(undefined); // сеть «ещё лежит» — запись остаётся
    });
    await core.enqueue(payloadOf(ID_A));

    core.kickFromNetworkSuccess();
    await settle(); // дождаться раунда, запущенного kick'ом
    expect(calls).toBe(1);

    core.kickFromNetworkSuccess(); // внутри окна дебаунса — no-op
    core.kickFromNetworkSuccess();
    await settle();
    expect(calls).toBe(1);

    t += NETWORK_SUCCESS_KICK_DEBOUNCE_MS + 1;
    core.kickFromNetworkSuccess(); // окно прошло — новый раунд
    await settle();
    expect(calls).toBe(2);
  });

  it('kickFromNetworkSuccess: пустая загруженная очередь — полный no-op', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage, now: () => 1 });
    let calls = 0;
    core.setSender(async () => {
      calls += 1;
      return {};
    });
    await core.ensureLoaded();
    core.kickFromNetworkSuccess();
    await Promise.resolve();
    expect(calls).toBe(0);
  });

  it('clearAll инвалидирует зависшую гидратацию и не воскрешает старый tenant', async () => {
    const oldEntry: QueuedCheck = {
      clientRequestId: ID_A,
      payload: payloadOf(ID_A),
      createdAt: 1,
      attempts: 0,
      status: 'pending',
    };
    const staleRead = deferred<string | null>();
    const map = new Map<string, string>([[OFFLINE_CHECK_QUEUE_STORAGE_KEY, serializeQueue([oldEntry])]]);
    const storage: QueueStorage = {
      getItem: async () => staleRead.promise,
      setItem: async (key, value) => {
        map.set(key, value);
      },
    };
    const core = createOfflineCheckQueueCore({ storage });

    const loading = core.ensureLoaded();
    await core.clearAll();
    staleRead.resolve(serializeQueue([oldEntry]));
    await loading;

    expect(core.getSnapshot()).toEqual([]);
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null)).toEqual([]);
  });

  it('clearAll во время pre-send persist не отправляет payload A под новой сессией', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));

    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const originalSetItem = storage.setItem;
    let blockNextWrite = true;
    storage.setItem = async (key, value) => {
      if (blockNextWrite) {
        blockNextWrite = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      await originalSetItem(key, value);
    };
    const sender = jest.fn(async () => ({ number: 1 }));
    core.setSender(sender);

    const flushing = core.flush();
    await writeStarted.promise;
    const clearing = core.clearAll();
    expect(core.getSnapshot()).toEqual([]);
    releaseWrite.resolve();
    await Promise.all([flushing, clearing]);

    expect(sender).not.toHaveBeenCalled();
    expect(core.getSnapshot()).toEqual([]);
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null)).toEqual([]);
  });

  it('clearAll игнорирует результат уже отправленного запроса и не вызывает callback', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));

    const sendStarted = deferred<void>();
    const sendResult = deferred<unknown>();
    const onSent = jest.fn();
    core.setSender(
      async () => {
        sendStarted.resolve();
        return sendResult.promise;
      },
      { onSent },
    );

    const flushing = core.flush();
    await sendStarted.promise;
    await core.clearAll();
    sendResult.resolve({ number: 1 });
    await flushing;

    expect(onSent).not.toHaveBeenCalled();
    expect(core.getSnapshot()).toEqual([]);
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null)).toEqual([]);
  });

  it('после failed tenant clear не пишет и не отправляет queue B до успешной границы', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));
    const originalSetItem = storage.setItem;
    let failClear = true;
    storage.setItem = async (key, value) => {
      if (failClear) throw new Error('native clear failed');
      await originalSetItem(key, value);
    };
    const sender = jest.fn(async () => ({ number: 1 }));
    core.setSender(sender);

    await expect(core.clearAll()).rejects.toThrow('native clear failed');
    await expect(core.enqueue(payloadOf(ID_B))).rejects.toThrow(/не готово после смены сессии/);
    await core.flush();
    expect(sender).not.toHaveBeenCalled();
    expect(parseStoredQueue(map.get(OFFLINE_CHECK_QUEUE_STORAGE_KEY) ?? null).map((e) => e.clientRequestId)).toEqual([
      ID_A,
    ]);

    failClear = false;
    await core.clearAll();
    await core.enqueue(payloadOf(ID_B));
    expect(core.getSnapshot().map((e) => e.clientRequestId)).toEqual([ID_B]);
  });

  it('конкурентные flush сливаются в один раунд', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    let calls = 0;
    core.setSender(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return {};
    });
    await core.enqueue(payloadOf(ID_A));
    const [a, b] = await Promise.all([core.flush(), core.flush()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it('flush без сконфигурированного сендера — безопасный no-op, данные на месте', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage });
    await core.enqueue(payloadOf(ID_A));
    const result = await core.flush();
    expect(result).toEqual({ sent: 0, rejected: 0, remaining: 1 });
    expect(core.getSnapshot()).toHaveLength(1);
  });
});

/**
 * Филиал чека в офлайн-очереди (мульти-точки 156/160).
 *
 * ПОЧЕМУ ЭТО ВАЖНО: сервер штампует точку в момент ПРИЁМА запроса. Живому
 * сабмиту это подходит, а запись из очереди может пролежать до возврата сети —
 * мастер набил чек на филиале А, доехал до Б, переключил точку, и выручка ушла
 * бы соседнему автосервису. Поэтому точка фиксируется в момент постановки в
 * очередь («Пробить») и уезжает в payload вместе с чеком.
 */
describe('offlineCheckQueue — филиал (pointId) фиксируется на «Пробить»', () => {
  const POINT_A = '11111111-1111-4111-8111-111111111111';
  const POINT_B = '22222222-2222-4222-8222-222222222222';

  it('штампует текущую точку в payload при постановке в очередь', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage, resolvePointId: async () => POINT_A });
    const entry = await core.enqueue(payloadOf(ID_A));
    expect(entry.payload.pointId).toBe(POINT_A);
  });

  it('точка НЕ меняется после переключения филиала — досылка уходит филиалу создания', async () => {
    const { storage } = createMemoryStorage();
    let current = POINT_A;
    const core = createOfflineCheckQueueCore({ storage, resolvePointId: async () => current });
    await core.enqueue(payloadOf(ID_A));
    // Мастер доехал до другого филиала и переключился ДО возврата сети.
    current = POINT_B;
    const sent: QueuedCheckPayload[] = [];
    core.setSender(async (payload) => {
      sent.push(payload);
      return {};
    });
    await core.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].pointId).toBe(POINT_A);
  });

  it('точки нет (одноточечный тенант / «Все точки») — payload байт-в-байт прежний', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage, resolvePointId: async () => null });
    const entry = await core.enqueue(payloadOf(ID_A));
    expect('pointId' in entry.payload).toBe(false);
  });

  it('явный pointId в payload не перетирается резолвом', async () => {
    const { storage } = createMemoryStorage();
    const core = createOfflineCheckQueueCore({ storage, resolvePointId: async () => POINT_A });
    const entry = await core.enqueue(payloadOf(ID_A, { pointId: POINT_B }));
    expect(entry.payload.pointId).toBe(POINT_B);
  });

  it('резолвер без инжекта и упавший резолвер не мешают чеку встать в очередь', async () => {
    const { storage } = createMemoryStorage();
    const bare = createOfflineCheckQueueCore({ storage });
    expect('pointId' in (await bare.enqueue(payloadOf(ID_A))).payload).toBe(false);

    // Падение резолвера филиала НЕ ИМЕЕТ ПРАВА терять чек: филиал сервер
    // подставит сам при досылке, а потерянный заказ-наряд не восстановит
    // никто. Ошибка трактуется как «точки нет».
    const { storage: storage2 } = createMemoryStorage();
    const throwing = createOfflineCheckQueueCore({
      storage: storage2,
      resolvePointId: async () => {
        throw new Error('storage down');
      },
    });
    const entry = await throwing.enqueue(payloadOf(ID_A));
    expect('pointId' in entry.payload).toBe(false);
    expect(throwing.getSnapshot()).toHaveLength(1);
  });
});
