/**
 * salaryAckQueue — модалка «зарплата выдана» больше не запирает приложение.
 *
 * Класс бага: единственная кнопка модалки делает сетевой запрос, и при любой
 * НЕ-4xx ошибке модалка не закрывалась — один пропавший запрос блокировал
 * сотруднику весь телефон. Теперь намерение («нажал кнопку») кладётся в эту
 * очередь и досылается позже, а модалка закрывается.
 */
import {
  SALARY_ACK_QUEUE_LIMIT,
  SALARY_ACK_QUEUE_STORAGE_KEY,
  createSalaryAckQueueCore,
  isPermanentAckRejection,
  parseStoredSalaryAcks,
  serializeSalaryAcks,
  type SalaryAckKind,
  type SalaryAckStorage,
} from '../salaryAckQueue';

function createMemoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  const storage: SalaryAckStorage = {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

function axiosError(status?: number): unknown {
  if (status === undefined) return new Error('Нет соединения с сервером');
  return { response: { status }, message: `Request failed with status code ${status}` };
}

describe('классификация отказа', () => {
  it('4xx — отметка больше не нужна, сеть/5xx — нужна', () => {
    expect(isPermanentAckRejection(axiosError(400))).toBe(true);
    expect(isPermanentAckRejection(axiosError(404))).toBe(true);
    expect(isPermanentAckRejection(axiosError(500))).toBe(false);
    expect(isPermanentAckRejection(axiosError(503))).toBe(false);
    expect(isPermanentAckRejection(axiosError())).toBe(false);
  });
});

describe('сериализация', () => {
  it('round-trip', () => {
    const acks = { payoutViewed: ['p1', 'p2'], paymentConfirmed: ['c1'] };
    expect(parseStoredSalaryAcks(serializeSalaryAcks(acks))).toEqual(acks);
  });

  it('мусор и чужая версия схемы — пустая очередь, а не краш', () => {
    expect(parseStoredSalaryAcks(null)).toEqual({ payoutViewed: [], paymentConfirmed: [] });
    expect(parseStoredSalaryAcks('{oops')).toEqual({ payoutViewed: [], paymentConfirmed: [] });
    expect(parseStoredSalaryAcks(JSON.stringify({ v: 999, payoutViewed: ['p1'] }))).toEqual({
      payoutViewed: [],
      paymentConfirmed: [],
    });
  });

  it('нестроковые id отбрасываются молча', () => {
    expect(parseStoredSalaryAcks(JSON.stringify({ v: 1, payoutViewed: ['p1', 42, null, 'p1'] })).payoutViewed).toEqual([
      'p1',
    ]);
  });
});

describe('очередь отложенных отметок', () => {
  it('отметка переживает перезапуск приложения', async () => {
    const { storage, map } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'payout-1');
    expect(core.has('payoutViewed', 'payout-1')).toBe(true);
    expect(parseStoredSalaryAcks(map.get(SALARY_ACK_QUEUE_STORAGE_KEY) ?? null).payoutViewed).toEqual(['payout-1']);

    const restarted = createSalaryAckQueueCore({ storage });
    await restarted.ensureLoaded();
    expect(restarted.has('payoutViewed', 'payout-1')).toBe(true);
  });

  it('дубликат — no-op', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'p1');
    await core.add('payoutViewed', 'p1');
    expect(core.snapshot().payoutViewed).toEqual(['p1']);
  });

  it('очередь не растёт бесконечно — самые старые вытесняются', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    for (let i = 0; i < SALARY_ACK_QUEUE_LIMIT + 5; i += 1) await core.add('payoutViewed', `p${i}`);
    const list = core.snapshot().payoutViewed;
    expect(list).toHaveLength(SALARY_ACK_QUEUE_LIMIT);
    expect(list[list.length - 1]).toBe(`p${SALARY_ACK_QUEUE_LIMIT + 4}`);
  });

  it('досылка снимает доехавшие отметки', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'p1');
    await core.add('paymentConfirmed', 'c1');

    const sent: Array<[SalaryAckKind, string]> = [];
    await core.flush(async (kind, id) => {
      sent.push([kind, id]);
    });
    expect(sent).toEqual([
      ['payoutViewed', 'p1'],
      ['paymentConfirmed', 'c1'],
    ]);
    expect(core.snapshot()).toEqual({ payoutViewed: [], paymentConfirmed: [] });
  });

  it('4xx (выплату отменили) снимает отметку насовсем — модалка не вернётся навечно', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'p1');
    await core.flush(async () => {
      throw axiosError(400);
    });
    expect(core.has('payoutViewed', 'p1')).toBe(false);
  });

  it('сетевой отказ оставляет отметку и ОСТАНАВЛИВАЕТ раунд', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'p1');
    await core.add('paymentConfirmed', 'c1');

    let calls = 0;
    await core.flush(async () => {
      calls += 1;
      throw axiosError();
    });
    // Сервер недоступен — вторую отметку даже не пробуем.
    expect(calls).toBe(1);
    expect(core.has('payoutViewed', 'p1')).toBe(true);
    expect(core.has('paymentConfirmed', 'c1')).toBe(true);

    // Связь вернулась — уходят обе.
    await core.flush(async () => {});
    expect(core.snapshot()).toEqual({ payoutViewed: [], paymentConfirmed: [] });
  });

  it('конкурентные досылки сливаются в одну', async () => {
    const { storage } = createMemoryStorage();
    const core = createSalaryAckQueueCore({ storage });
    await core.add('payoutViewed', 'p1');
    let calls = 0;
    const send = async () => {
      calls += 1;
    };
    await Promise.all([core.flush(send), core.flush(send)]);
    expect(calls).toBe(1);
  });
});
