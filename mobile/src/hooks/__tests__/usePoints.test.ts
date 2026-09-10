/**
 * `usePoints.ts` тянет axios / AsyncStorage / react-native на верхнем уровне
 * (api, AuthContext, офлайн-очередь, персистентный кеш), а тесту нужна ТОЛЬКО
 * чистая функция правила. Моки не дают RN-цепочке грузиться в node-окружении
 * jest — та же конвенция, что в hooks/__tests__/useUsers.test.ts.
 */
jest.mock('../../api/services', () => ({ pointsApi: { list: jest.fn(), switch: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../utils/offlineCheckQueue', () => ({ setOfflineCheckQueuePointId: jest.fn() }));
jest.mock('../../utils/persistentCache', () => ({ clearPersistentCacheForPointSwitch: jest.fn() }));

import { derivePointAccess } from '../usePoints';
import type { TenantPoint } from '../../../../shared/types';

/**
 * Правило доступа к филиалам на клиенте (156/160/161).
 *
 * ЗОНА ДЕНЕГ. `needsPointForWrite` обязан повторять серверный
 * resolvePointForWrite (backend/src/common/point-scope.ts) — «есть назначения
 * на живые точки: доступны только они; нет назначений: все живые точки». Если
 * правила разъедутся, клиент либо блокирует пробитие там, где сервер молча
 * подставил бы точку, либо отпускает чек в 400 уже после нажатия «Пробить».
 *
 * `multiPoint` охраняет вторую половину бага: у держателя user_management два
 * режима даже при ЕДИНСТВЕННОМ филиале (сам филиал и «Все точки»), поэтому
 * переключатель и раздел «Филиалы» ему видны всегда, когда точки есть. Пока он
 * прятался, владелец не мог ни выйти из «Всех точек», ни назначить сотрудников
 * на точку.
 */

const point = (id: string, memberIds: string[] = []): TenantPoint =>
  ({ id, name: `Филиал ${id}`, memberIds, isMain: false, sortOrder: 0 }) as unknown as TenantPoint;

/** Основной сервис тенанта (160, is_main) — сам автосервис владельца. */
const mainPoint = (id: string, memberIds: string[] = []): TenantPoint =>
  ({ id, name: 'ZR AUTO', memberIds, isMain: true, sortOrder: 5 }) as unknown as TenantPoint;

const access = (over: Partial<Parameters<typeof derivePointAccess>[0]>) =>
  derivePointAccess({
    points: [],
    resolvedPointId: null,
    sessionPointId: null,
    userId: 'u1',
    canManage: false,
    isLoading: false,
    ...over,
  });

describe('derivePointAccess — что показывать', () => {
  it('одноточечный тенант (точек нет вовсе): ничего не показываем', () => {
    const a = access({ points: [] });
    expect(a.multiPoint).toBe(false);
    expect(a.needsPointForWrite).toBe(false);
  });

  it('владельцу с ОДНИМ филиалом переключатель ВИДЕН — у него ещё режим «Все точки»', () => {
    const a = access({ points: [point('p1')], canManage: true });
    expect(a.multiPoint).toBe(true);
    // Сервер подставит единственную точку молча — предупреждать не о чем.
    expect(a.needsPointForWrite).toBe(false);
  });

  it('сотруднику, назначенному на один филиал, показывать нечего', () => {
    const a = access({ points: [point('p1', ['u1']), point('p2', ['u2'])] });
    expect(a.selectable.map((p) => p.id)).toEqual(['p1']);
    expect(a.multiPoint).toBe(false);
    expect(a.needsPointForWrite).toBe(false);
  });

  it('сотрудник на двух филиалах видит переключатель, даже без user_management', () => {
    const a = access({ points: [point('p1', ['u1']), point('p2', ['u1'])] });
    expect(a.multiPoint).toBe(true);
    expect(a.canSeeAllPoints).toBe(false);
  });
});

/**
 * Основной сервис (160) — САМ автосервис владельца, ему принадлежит вся
 * история до появления филиалов. Он обязан идти первым и быть отделим от
 * филиалов: иначе владелец увидит свою многолетнюю выручку строкой вровень с
 * только что открытым «ТопГазом» и решит, что цифры перепутаны.
 */
describe('derivePointAccess — основной сервис и филиалы', () => {
  it('основной идёт ПЕРВЫМ, даже если сервер прислал его в конце', () => {
    const a = access({ points: [point('p2'), point('p1'), mainPoint('m1')], canManage: true });
    expect(a.selectable.map((p) => p.id)).toEqual(['m1', 'p1', 'p2']);
    expect(a.mainPoint?.id).toBe('m1');
    expect(a.branches.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('сотруднику, назначенному только на филиал, основной не показывается', () => {
    const a = access({ points: [mainPoint('m1'), point('p1', ['u1']), point('p2', ['u1'])] });
    expect(a.mainPoint).toBeNull();
    expect(a.branches.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('derivePointAccess — уйдёт ли денежная запись в 400', () => {
  it('без назначений доступны ВСЕ живые точки (безопасный дефолт 156)', () => {
    const a = access({ points: [point('p1'), point('p2')] });
    expect(a.writePointCount).toBe(2);
    expect(a.needsPointForWrite).toBe(true);
  });

  it('назначения сужают доступ — как на сервере, и право тут ни при чём', () => {
    // Владелец (user_management) назначен ровно на один филиал из трёх: сервер
    // про его право не знает и подставит p1 молча. Предупреждать нельзя.
    const a = access({ points: [point('p1', ['u1']), point('p2'), point('p3')], canManage: true });
    expect(a.writePointCount).toBe(1);
    expect(a.needsPointForWrite).toBe(false);
    // При этом выбирать ему по-прежнему есть из чего.
    expect(a.selectable).toHaveLength(3);
  });

  it('выбранный филиал снимает вопрос полностью', () => {
    const a = access({ points: [point('p1'), point('p2')], resolvedPointId: 'p1' });
    expect(a.currentPointId).toBe('p1');
    expect(a.needsPointForWrite).toBe(false);
  });
});

describe('derivePointAccess — холодный старт', () => {
  it('до ответа /points филиал берётся из сессии, а не считается «Все точки»', () => {
    const a = access({ points: [], resolvedPointId: undefined, sessionPointId: 'p9' });
    expect(a.currentPointId).toBe('p9');
  });

  it('ответ /points ПЕРЕБИВАЕТ сессию, в том числе явным «Все точки»', () => {
    const a = access({ points: [point('p1'), point('p2')], resolvedPointId: null, sessionPointId: 'p1' });
    expect(a.currentPointId).toBeNull();
    expect(a.needsPointForWrite).toBe(true);
  });
});
