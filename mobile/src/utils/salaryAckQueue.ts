/**
 * salaryAckQueue — ОТЛОЖЕННЫЕ отметки по выплате зарплаты.
 *
 * ПОЧЕМУ (пакет «потеря данных», 2026-09). Модалка «зарплата выдана»
 * (SalaryReceivedModal) — единственный экран приложения БЕЗ выхода: у неё одна
 * кнопка, и та делает сетевой запрос. Пока запрос не прошёл, модалка висит
 * поверх всего приложения — то есть один пропавший запрос (метро, подвал,
 * упавший шлюз) полностью блокировал сотруднику телефон. Закрывались только
 * 4xx-случаи, а именно они как раз и НЕ сетевые.
 *
 * РЕШЕНИЕ. Отметку разрешено НЕ доставить сейчас: она кладётся сюда, в
 * долговременную очередь на телефоне, модалка закрывается, а следующий цикл
 * проверки (вход, возврат приложения на передний план, пуш о зарплате) досылает
 * её. Владелец всё равно увидит «просмотрено» / «получение подтверждено», просто
 * чуть позже — это честнее, чем запертый телефон.
 *
 * ЧТО СЮДА ПОПАДАЕТ — ТОЛЬКО НАМЕРЕНИЕ, ВЫРАЖЕННОЕ ЧЕЛОВЕКОМ: запись создаётся
 * ровно тогда, когда сотрудник НАЖАЛ кнопку и запрос отказал НЕ по вине данных
 * (сеть / 5xx). Закрытие модалки кнопкой «Позже» сюда не пишет ничего: «позже»
 * значит «я ещё не решил», и такая выплата всплывёт снова.
 *
 * АРХИТЕКТУРА — как у offlineCheckQueue: ядро полностью dependency-injected и
 * без top-level импортов react-native, поэтому тестируется под node-jest;
 * синглтон получает AsyncStorage ленивым require в рантайме.
 */

/** Минимальный интерфейс хранилища (в рантайме — AsyncStorage). */
export interface SalaryAckStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Что именно не доехало:
 *   • 'payoutViewed'      — salary_payouts.id, отметка «сотрудник увидел» (158).
 *                           Денег не двигает, это read-receipt для владельца.
 *   • 'paymentConfirmed'  — salary_payments.id, легаси «подтвердить получение».
 */
export type SalaryAckKind = 'payoutViewed' | 'paymentConfirmed';

export const SALARY_ACK_KINDS: readonly SalaryAckKind[] = ['payoutViewed', 'paymentConfirmed'];

export type StoredSalaryAcks = Record<SalaryAckKind, readonly string[]>;

/** Версионированный ключ AsyncStorage — смена схемы = новый суффикс. */
export const SALARY_ACK_QUEUE_STORAGE_KEY = 'salary_ack_queue_v1';

/**
 * Потолок на вид отметки. Очередь не растёт бесконечно даже у сотрудника,
 * который месяцами ходит без связи: лишнее вытесняется с головы (самые старые
 * отметки наименее интересны владельцу). Пятьдесят — это годы выплат.
 */
export const SALARY_ACK_QUEUE_LIMIT = 50;

const STORAGE_VERSION = 1;

function emptyAcks(): StoredSalaryAcks {
  return { payoutViewed: [], paymentConfirmed: [] };
}

function sanitizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item && !out.includes(item)) out.push(item);
  }
  return out.slice(-SALARY_ACK_QUEUE_LIMIT);
}

/**
 * Разбор сырого значения из хранилища. Повреждённый JSON или чужая версия
 * схемы → пустая очередь: отметка «просмотрено» не стоит краша на старте.
 */
export function parseStoredSalaryAcks(raw: string | null): StoredSalaryAcks {
  if (!raw) return emptyAcks();
  try {
    const parsed = JSON.parse(raw) as ({ v?: number } & Partial<Record<SalaryAckKind, unknown>>) | null;
    if (!parsed || parsed.v !== STORAGE_VERSION) return emptyAcks();
    return {
      payoutViewed: sanitizeIds(parsed.payoutViewed),
      paymentConfirmed: sanitizeIds(parsed.paymentConfirmed),
    };
  } catch {
    return emptyAcks();
  }
}

/** Обратная сторона parseStoredSalaryAcks — версионированный конверт. */
export function serializeSalaryAcks(acks: StoredSalaryAcks): string {
  return JSON.stringify({ v: STORAGE_VERSION, ...acks });
}

export interface SalaryAckQueueCore {
  /** Гидратация из хранилища (идемпотентная). */
  ensureLoaded(): Promise<void>;
  /** Текущее содержимое (стабильная ссылка между изменениями). */
  snapshot(): StoredSalaryAcks;
  /** Стоит ли отметка в очереди (значит, модалку по этому id показывать не надо). */
  has(kind: SalaryAckKind, id: string): boolean;
  /** Поставить отметку в очередь. Дубликат — no-op. */
  add(kind: SalaryAckKind, id: string): Promise<void>;
  /** Убрать отметку (доехала либо перестала быть актуальной). */
  remove(kind: SalaryAckKind, id: string): Promise<void>;
  /**
   * Досылка. `send` бросает — решает {@link isPermanentAckRejection}: 4xx
   * (выплату отменили/сторнировали/уже отметили) снимает отметку насовсем,
   * сеть/5xx оставляет её до следующего раза и ОСТАНАВЛИВАЕТ раунд — сервер
   * недоступен, молотить остальные бессмысленно.
   */
  flush(send: (kind: SalaryAckKind, id: string) => Promise<unknown>): Promise<void>;
}

/** 4xx = отметка больше не имеет смысла (выплату отменили / уже отмечена). Повтор не поможет. */
export function isPermanentAckRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function createSalaryAckQueueCore(deps: { storage: SalaryAckStorage }): SalaryAckQueueCore {
  let acks: StoredSalaryAcks = emptyAcks();
  let loaded = false;
  let loadPromise: Promise<void> | null = null;
  let flushing: Promise<void> | null = null;

  async function persist(next: StoredSalaryAcks): Promise<void> {
    acks = next;
    try {
      await deps.storage.setItem(SALARY_ACK_QUEUE_STORAGE_KEY, serializeSalaryAcks(next));
    } catch {
      // Диск отказал ПОСЛЕ обновления памяти: в этой сессии отметка всё равно
      // не покажет модалку повторно и будет дослана. Хуже чем ничего не бывает.
    }
  }

  function ensureLoaded(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (!loadPromise) {
      loadPromise = deps.storage
        .getItem(SALARY_ACK_QUEUE_STORAGE_KEY)
        .then((raw) => {
          const restored = parseStoredSalaryAcks(raw);
          // Не затираем отметки, поставленные, пока читался диск.
          acks = {
            payoutViewed: [...new Set([...restored.payoutViewed, ...acks.payoutViewed])],
            paymentConfirmed: [...new Set([...restored.paymentConfirmed, ...acks.paymentConfirmed])],
          };
          loaded = true;
        })
        .catch(() => {
          loaded = true;
        })
        .finally(() => {
          loadPromise = null;
        });
    }
    return loadPromise;
  }

  return {
    ensureLoaded,
    snapshot: () => acks,
    has: (kind, id) => acks[kind].includes(id),
    add: async (kind, id) => {
      if (!id) return;
      await ensureLoaded();
      if (acks[kind].includes(id)) return;
      const next = [...acks[kind], id].slice(-SALARY_ACK_QUEUE_LIMIT);
      await persist({ ...acks, [kind]: next });
    },
    remove: async (kind, id) => {
      await ensureLoaded();
      if (!acks[kind].includes(id)) return;
      await persist({ ...acks, [kind]: acks[kind].filter((x) => x !== id) });
    },
    flush: async (send) => {
      if (flushing) return flushing;
      const round = (async () => {
        await ensureLoaded();
        for (const kind of SALARY_ACK_KINDS) {
          // Копия списка: persist ниже подменяет массив на каждом шаге.
          for (const id of [...acks[kind]]) {
            try {
              await send(kind, id);
            } catch (error) {
              if (!isPermanentAckRejection(error)) return; // сервер недоступен — раунд окончен
            }
            await persist({ ...acks, [kind]: acks[kind].filter((x) => x !== id) });
          }
        }
      })().finally(() => {
        flushing = null;
      });
      flushing = round;
      return round;
    },
  };
}

// ── Синглтон приложения ────────────────────────────────────────────────────
// AsyncStorage подключается ЛЕНИВЫМ require: top-level импорт протащил бы
// react-native в node-jest (тесты не транспилируют node_modules).

let singleton: SalaryAckQueueCore | null = null;

export function getSalaryAckQueue(): SalaryAckQueueCore {
  if (!singleton) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage')
      .default as typeof import('@react-native-async-storage/async-storage').default;
    singleton = createSalaryAckQueueCore({
      storage: {
        getItem: (key) => AsyncStorage.getItem(key),
        setItem: (key, value) => AsyncStorage.setItem(key, value),
      },
    });
  }
  return singleton;
}
