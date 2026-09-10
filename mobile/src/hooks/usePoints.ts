/**
 * usePoints — единственный источник правды о филиалах (мульти-точки 156/160/161)
 * на клиенте.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Правило «кто какие точки видит» повторялось в трёх
 * местах (чип на дашборде, пункт «Ещё», экран точек) и уже разъезжалось:
 * дашборд показывал переключатель мастеру, а пункт меню требовал
 * user_management. Разъезд в этой зоне стоит денег — заказ-наряд, пробитый не
 * на том филиале, уезжает в чужую выручку и чужую зарплату. Поэтому и правило
 * доступа, и сама процедура переключения живут здесь в одном экземпляре.
 *
 * ПРАВИЛО ДОСТУПА (зеркало PointsService.switchPoint на сервере):
 *   • держатель user_management (владелец/админ) — все живые точки + режим
 *     «Все точки» (сброс выбора, currentPointId = null);
 *   • сотрудник, назначенный хотя бы на одну точку, — только свои (memberIds),
 *     без «Всех точек»: филиал ему обязателен (160);
 *   • сотрудник БЕЗ явных назначений не ограничен (безопасный дефолт 156) —
 *     видит все точки, но по-прежнему без «Всех точек».
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { setOfflineCheckQueuePointId } from '../utils/offlineCheckQueue';
import { clearPersistentCacheForPointSwitch } from '../utils/persistentCache';
import type { PointsListResponse, TenantPoint } from '../../../shared/types';

/** Канонический ключ списка точек — один слот кеша на всё приложение. */
export const POINTS_QUERY_KEY = ['points'] as const;

/**
 * GET /points. Ходить в pointsApi.list() напрямую больше не нужно: единый ключ
 * = единая форма данных в кеше (та же дисциплина, что у useUsers) и один
 * сетевой запрос на весь экран.
 */
export function usePointsQuery() {
  const query = useQuery<PointsListResponse>({
    queryKey: POINTS_QUERY_KEY,
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  });

  // Офлайн-очередь чеков штампует филиал в момент нажатия «Пробить», а живёт
  // модулем без провайдеров и читает точку из сохранённой сессии — та
  // обновляется только после GET /auth/me. Сообщаем ей точку сразу, как её
  // узнал первый экран: присваивание модульной переменной идемпотентно,
  // поэтому лишние вызовы из других потребителей хука безвредны.
  const resolvedPointId = query.data?.currentPointId;
  useEffect(() => {
    if (resolvedPointId === undefined) return;
    setOfflineCheckQueuePointId(resolvedPointId);
  }, [resolvedPointId]);

  return query;
}

export interface PointAccess {
  /** Все живые точки тенанта (может быть больше, чем доступно пользователю). */
  points: TenantPoint[];
  /** Точки, между которыми пользователь ВПРАВЕ переключаться. */
  selectable: TenantPoint[];
  /** Текущий филиал; null = режим «Все точки». */
  currentPointId: string | null;
  currentPoint: TenantPoint | null;
  /** Право управлять назначениями сотрудников на точки. */
  canManage: boolean;
  /** Доступен ли режим «Все точки» (сводка по сети). */
  canSeeAllPoints: boolean;
  /**
   * Показывать ли индикатор филиала и раздел «Филиалы».
   *
   * Два случая, а не один:
   *   • переключать есть что (доступно больше одного филиала) — очевидный;
   *   • держатель user_management при ХОТЯ БЫ ОДНОМ филиале у тенанта: у него
   *     два режима даже с единственной точкой — сам филиал и «Все точки»
   *     (сводка по сети), и цифры в них РАЗНЫЕ. Пока индикатор прятался,
   *     владелец не мог ни понять, в каком он режиме, ни выйти из «Всех
   *     точек», ни попасть в «Филиалы», чтобы назначить туда сотрудников, —
   *     тупик на ровном месте.
   */
  multiPoint: boolean;
  /**
   * Сколько филиалов сервер посчитал бы «доступными» для ДЕНЕЖНОЙ ЗАПИСИ.
   * Зеркало resolvePointForWrite (backend/src/common/point-scope.ts): есть
   * назначения на живые точки — только они; нет назначений — все живые точки
   * тенанта. Право user_management здесь НИ ПРИ ЧЁМ: сервер про него не знает.
   */
  writePointCount: number;
  /**
   * Уйдёт ли денежная запись в отказ 400 «Выберите филиал». True ровно тогда,
   * когда филиал не выбран, а подставить его молча сервер не сможет
   * (доступных больше одного). Экран Кассы спрашивает это ДО отправки, чтобы
   * кассир не упирался в ошибку уже после нажатия «Пробить».
   */
  needsPointForWrite: boolean;
  isLoading: boolean;
}

/**
 * ЧИСТОЕ правило доступа к филиалам — без react-query и без AuthContext,
 * поэтому покрывается юнит-тестом (hooks/__tests__/usePoints.test.ts).
 *
 * Зона денег: `needsPointForWrite` обязан ПОБИТОВО повторять серверный
 * resolvePointForWrite (backend/src/common/point-scope.ts). Разъедется —
 * клиент либо блокирует пробитие там, где сервер молча подставил бы точку,
 * либо (хуже) отпускает чек в 400 уже после нажатия «Пробить».
 *
 * Поля входа:
 *   • `points` — живые точки тенанта из GET /points (может быть пусто);
 *   • `resolvedPointId` — текущая точка ИЗ ОТВЕТА /points; `undefined` = ответа
 *     ещё нет, и тогда берётся `sessionPointId` (холодный старт: филиал уже
 *     лежит в персистентной сессии /auth/me, и индикатор обязан быть верным ДО
 *     первого ответа сети — иначе Касса секунду показывает «Все точки» там, где
 *     филиал на самом деле выбран). Явный `null` из ответа означает
 *     СОЗНАТЕЛЬНЫЙ режим «Все точки» и сессию перебивает.
 */
export function derivePointAccess(input: {
  points: TenantPoint[];
  resolvedPointId: string | null | undefined;
  sessionPointId: string | null | undefined;
  userId: string | undefined;
  canManage: boolean;
  isLoading: boolean;
}): PointAccess {
  const { points, resolvedPointId, sessionPointId, userId, canManage, isLoading } = input;
  const assigned = userId ? points.filter((p) => p.memberIds?.includes(userId)) : [];
  const selectable = canManage || assigned.length === 0 ? points : assigned;
  const currentPointId = resolvedPointId !== undefined ? resolvedPointId : (sessionPointId ?? null);
  const currentPoint = currentPointId ? (points.find((p) => p.id === currentPointId) ?? null) : null;
  // Доступность для ЗАПИСИ считаем так же, как сервер: по назначениям, а не по
  // правам. Иначе владелец, назначенный ровно на один филиал, получал бы
  // предупреждение там, где сервер молча подставил бы его точку.
  const writePointCount = assigned.length > 0 ? assigned.length : points.length;
  return {
    points,
    selectable,
    currentPointId,
    currentPoint,
    canManage,
    canSeeAllPoints: canManage,
    multiPoint: selectable.length > 1 || (canManage && points.length > 0),
    writePointCount,
    needsPointForWrite: currentPointId === null && writePointCount > 1,
    isLoading,
  };
}

export function usePointAccess(): PointAccess {
  const { user, hasPermission } = useAuth();
  const { data, isLoading } = usePointsQuery();
  const canManage = hasPermission('user_management');
  const userId = user?.id;
  const sessionPointId = user?.currentPointId;

  return useMemo(
    () =>
      derivePointAccess({
        points: data?.points ?? [],
        resolvedPointId: data ? data.currentPointId : undefined,
        sessionPointId,
        userId,
        canManage,
        isLoading,
      }),
    [data, userId, sessionPointId, canManage, isLoading],
  );
}

/**
 * Переключение филиала — единственная точка входа.
 *
 * ПОЧЕМУ ЗДЕСЬ ЖЁСТКИЙ СБРОС, А НЕ ТОЧЕЧНАЯ ИНВАЛИДАЦИЯ. После смены филиала
 * меняется ответ практически КАЖДОГО денежного эндпоинта (журнал, дашборд,
 * отчёты, зарплата, смены, расходы, кассовая смена, рассрочка, возвраты,
 * клиенты, машины…). Точечный список ключей уже отставал от бэкенда и молча
 * показывал чужие деньги. Поэтому:
 *   1. отменяем запросы, ушедшие в сеть ещё со СТАРЫМ филиалом;
 *   2. `resetQueries` (а не `invalidateQueries`) — данные становятся
 *      undefined, поэтому экран покажет загрузку, а НЕ цифры чужого филиала
 *      на время рефетча;
 *   3. чистим персистентный кеш на диске целиком — слоты писались без учёта
 *      филиала, и на холодном старте подняли бы прошлый филиал обратно.
 * Список точек (['points']) из сброса исключён: денег в нём нет, а без него
 * мигал бы сам индикатор филиала.
 */
export function useSwitchPoint() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  const mutation = useMutation({
    mutationFn: async (pointId: string | null) => (await pointsApi.switch(pointId)).data,
    onSuccess: async (res) => {
      // Сервер мог ПОДСТАВИТЬ точку сам (сотруднику без user_management с
      // единственной доступной точкой сброс схлопывается в неё) — источник
      // правды именно ответ, а не то, что мы просили.
      const effective = res?.currentPointId ?? null;

      // Офлайн-очередь — первым делом и синхронно: между переключением и
      // обновлением сессии пользователь уже может нажать «Пробить».
      setOfflineCheckQueuePointId(effective);

      await queryClient.cancelQueries();
      queryClient.setQueryData<PointsListResponse>(POINTS_QUERY_KEY, (prev) =>
        prev ? { ...prev, currentPointId: effective } : prev,
      );
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== POINTS_QUERY_KEY[0] });
      void clearPersistentCacheForPointSwitch();
      void queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
      // Персистентная сессия: без неё User.currentPointId остался бы прежним и
      // холодный старт снова показал бы прошлый филиал.
      void refreshUser();
    },
  });

  const { mutateAsync } = mutation;
  const switchPoint = useCallback((pointId: string | null) => mutateAsync(pointId), [mutateAsync]);

  return { switchPoint, isSwitching: mutation.isPending };
}
