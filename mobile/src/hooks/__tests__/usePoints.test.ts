/**
 * `usePoints.ts` тянет axios / AsyncStorage / react-native на верхнем уровне
 * (api, AuthContext, офлайн-очередь), а тесту нужна ТОЛЬКО чистая функция
 * правила. Моки не дают RN-цепочке грузиться в node-окружении jest — та же
 * конвенция, что в hooks/__tests__/useUsers.test.ts.
 */
jest.mock('../../api/services', () => ({ pointsApi: { list: jest.fn(), summary: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../utils/offlineCheckQueue', () => ({ setOfflineCheckQueuePointId: jest.fn() }));

import { derivePointAccess } from '../usePoints';
import type { TenantPoint } from '../../../../shared/types';

/**
 * Правило доступа к филиалам на клиенте (156/160/161/163).
 *
 * ЗОНА ДОСТУПА И ДЕНЕГ. `selectable` обязан ПОБИТОВО повторять серверную
 * функцию autexa_available_points (миграция 163): «есть назначения на живые
 * филиалы — доступны только они; назначений нет вовсе — доступны все живые».
 * Разъедется — раздел «Филиалы» предложит человеку войти туда, куда сервер его
 * не пустит (403 на втором шаге входа), либо спрячет филиал, в котором он
 * реально работает.
 *
 * Право user_management в этом правиле НЕ участвует: сервер при входе про него
 * не спрашивает. Владелец, назначенный на один филиал, входит только в него —
 * и клиент обязан показывать ровно это.
 *
 * `multiPoint` охраняет вторую половину: одноточечный автосервис не должен
 * заметить мульти-точек вообще — ни раздела, ни индикатора.
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
  it('одноточечный тенант (филиалов нет вовсе): ничего не показываем', () => {
    expect(access({ points: [] }).multiPoint).toBe(false);
  });

  it('ровно один автосервис — раздел и индикатор всё ещё не нужны', () => {
    // Второго автосервиса не существует: показывать «вы в ZR AUTO» — шум.
    expect(access({ points: [mainPoint('m1')], canManage: true }).multiPoint).toBe(false);
  });

  it('два автосервиса — показываем всем, в том числе мастеру', () => {
    expect(access({ points: [mainPoint('m1'), point('p1')] }).multiPoint).toBe(true);
  });
});

describe('derivePointAccess — куда человека пустит сервер', () => {
  it('без назначений доступны ВСЕ живые филиалы (безопасный дефолт 156)', () => {
    const a = access({ points: [point('p1'), point('p2')] });
    expect(a.selectable.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('назначения сужают доступ до своих филиалов', () => {
    const a = access({ points: [point('p1', ['u1']), point('p2', ['u2'])] });
    expect(a.selectable.map((p) => p.id)).toEqual(['p1']);
  });

  it('право user_management доступ НЕ расширяет — сервер про него не знает', () => {
    // Владелец назначен ровно на один филиал из трёх: autexa_available_points
    // вернёт ему один, и второй шаг входа в остальные ответит 403. Показать
    // ему кнопку «войти» в них значило бы обещать невозможное.
    const a = access({ points: [point('p1', ['u1']), point('p2'), point('p3')], canManage: true });
    expect(a.selectable.map((p) => p.id)).toEqual(['p1']);
    // При этом карточки всех филиалов раздел рисует по `points`, а не по
    // `selectable`: сводка по сети — это взгляд сверху.
    expect(a.points).toHaveLength(3);
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

  it('сотруднику, назначенному только на филиал, основной недоступен', () => {
    const a = access({ points: [mainPoint('m1'), point('p1', ['u1']), point('p2', ['u1'])] });
    expect(a.mainPoint).toBeNull();
    expect(a.branches.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('derivePointAccess — филиал текущей сессии', () => {
  it('до ответа /points филиал берётся из сессии — индикатор верен сразу', () => {
    const a = access({ points: [], resolvedPointId: undefined, sessionPointId: 'p9' });
    expect(a.currentPointId).toBe('p9');
  });

  it('ответ /points перебивает сессию: оба источника — один и тот же токен', () => {
    const a = access({ points: [point('p1'), point('p2')], resolvedPointId: 'p2', sessionPointId: 'p1' });
    expect(a.currentPointId).toBe('p2');
    expect(a.currentPoint?.id).toBe('p2');
  });

  it('null от сервера = у тенанта нет живых филиалов (одноточечный)', () => {
    const a = access({ points: [], resolvedPointId: null, sessionPointId: 'p1' });
    expect(a.currentPointId).toBeNull();
    expect(a.currentPoint).toBeNull();
    expect(a.multiPoint).toBe(false);
  });
});
