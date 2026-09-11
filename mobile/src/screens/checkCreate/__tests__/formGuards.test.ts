/**
 * Стражи формы Кассы — деньги и потеря набранного заказ-наряда.
 *
 * Класс багов, который они закрывают:
 *   • «после входа в другой филиал в заказ-наряде остался мастер прежнего» —
 *     зарплата и рейтинг уезжают в чужой автосервис, и по экрану это не видно;
 *   • «касса, открытая пушем, отдаёт набранный заказ-наряд по кнопке назад и
 *     свайпу без вопроса» — 10 минут работы исчезают молча.
 */
import { buildCheckFormFingerprint, findStrayMaster, type CheckFormSnapshot } from '../formGuards';

const POINT_MASTERS = new Set(['m-a', 'm-b']);

function line(name: string, master?: string) {
  return { name, serviceId: `s-${name}`, price: 100, quantity: 1, lineMasterId: master };
}

describe('findStrayMaster — мастер обязан работать в этом филиале', () => {
  it('мастер чека из филиала, строки наследуют его — всё в порядке', () => {
    expect(
      findStrayMaster({
        pointMasterIds: POINT_MASTERS,
        checkMasterId: 'm-a',
        lines: [line('Замена масла'), line('Развал', 'm-b')],
      }),
    ).toBeNull();
  });

  it('мастер чека из ПРЕЖНЕГО филиала — просим выбрать мастера заказ-наряда', () => {
    expect(findStrayMaster({ pointMasterIds: POINT_MASTERS, checkMasterId: 'm-from-other-point', lines: [] })).toEqual({
      kind: 'check',
    });
  });

  it('пустой мастер чека — тоже повод спросить (иначе бэк получит чужого/никакого)', () => {
    expect(findStrayMaster({ pointMasterIds: POINT_MASTERS, checkMasterId: '', lines: [] })).toEqual({ kind: 'check' });
  });

  it('чужой мастер в СТРОКЕ услуг — показываем именно её', () => {
    expect(
      findStrayMaster({
        pointMasterIds: POINT_MASTERS,
        checkMasterId: 'm-a',
        lines: [line('Замена масла'), line('Развал', 'm-stranger')],
      }),
    ).toEqual({ kind: 'line', index: 1, name: 'Развал' });
  });

  it('строка без своего мастера наследует мастера чека и второй раз не ругается', () => {
    expect(
      findStrayMaster({
        pointMasterIds: POINT_MASTERS,
        checkMasterId: 'm-a',
        lines: [{ name: 'Диагностика' }],
      }),
    ).toBeNull();
  });

  it('справочник филиала ещё не приехал (или филиал один) — касса НЕ блокируется', () => {
    expect(findStrayMaster({ pointMasterIds: new Set(), checkMasterId: 'кто-угодно', lines: [] })).toBeNull();
  });
});

const EMPTY: CheckFormSnapshot = {
  clientId: '',
  carId: '',
  masterId: '',
  mileage: '',
  comment: '',
  discount: '',
  paymentMethod: 'cash',
  cashAmount: '',
  installmentFirst: '',
  isDeferred: false,
  tagIds: [],
  assigneeIds: [],
  orderLocationId: null,
  serviceLines: [],
  productLines: [],
  pendingPhotos: [],
  manualDateIso: '',
};

describe('buildCheckFormFingerprint — «в форме есть несохранённое»', () => {
  it('пустая форма стабильна: отпечаток не зависит от новых ссылок на массивы', () => {
    expect(buildCheckFormFingerprint({ ...EMPTY })).toBe(buildCheckFormFingerprint({ ...EMPTY, tagIds: [] }));
  });

  it('добавленная услуга меняет отпечаток', () => {
    const withService = {
      ...EMPTY,
      serviceLines: [{ serviceId: 's1', name: 'Замена масла', price: 1500, quantity: 1, master: 'm-a' }],
    };
    expect(buildCheckFormFingerprint(withService)).not.toBe(buildCheckFormFingerprint(EMPTY));
  });

  it('добавленный товар, фото, клиент и комментарий — каждый сам по себе делает форму грязной', () => {
    const base = buildCheckFormFingerprint(EMPTY);
    expect(
      buildCheckFormFingerprint({
        ...EMPTY,
        productLines: [{ productId: 'p1', name: 'Фильтр', sellPrice: 400, quantity: 2 }],
      }),
    ).not.toBe(base);
    expect(buildCheckFormFingerprint({ ...EMPTY, pendingPhotos: ['file://1.jpg'] })).not.toBe(base);
    expect(buildCheckFormFingerprint({ ...EMPTY, clientId: 'c1' })).not.toBe(base);
    expect(buildCheckFormFingerprint({ ...EMPTY, comment: 'скрипит подвеска' })).not.toBe(base);
  });

  it('пробелы вокруг текста не считаются правкой (случайный тап по полю не поднимает вопрос)', () => {
    expect(buildCheckFormFingerprint({ ...EMPTY, comment: '   ', mileage: ' ' })).toBe(
      buildCheckFormFingerprint(EMPTY),
    );
  });

  it('смена мастера строки видна отпечатку (это перенос зарплаты)', () => {
    const a = buildCheckFormFingerprint({
      ...EMPTY,
      serviceLines: [{ serviceId: 's1', name: 'Развал', price: 2000, quantity: 1, master: 'm-a' }],
    });
    const b = buildCheckFormFingerprint({
      ...EMPTY,
      serviceLines: [{ serviceId: 's1', name: 'Развал', price: 2000, quantity: 1, master: 'm-b' }],
    });
    expect(a).not.toBe(b);
  });
});
