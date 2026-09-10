/**
 * usePoints — единственный источник правды об автосервисах владельца
 * (основной сервис + филиалы, мульти-точки 156/160/161) в вебе.
 *
 * ПОЧЕМУ ЭТО ВООБЩЕ КАСАЕТСЯ ВЕБА. Текущий автосервис хранится НА СЕРВЕРЕ
 * (users.current_point_id) и приезжает в JWT-акторе, поэтому веб и так
 * фильтрует журнал, кассу и отчёты по тому автосервису, который выбран в
 * телефоне, — молча. Владелец за компьютером видел цифры одного и считал их
 * цифрами всех.
 *
 * ГДЕ ПЕРЕКЛЮЧАЮТ. Ровно в одном месте — на странице «Филиалы» (/points).
 * Требование владельца дословно: «переключиться туда можно ТОЛЬКО через
 * филиал, а не везде». В шапке остаётся НЕинтерактивный индикатор
 * (components/PointIndicator), он только показывает и ведёт на страницу.
 *
 * ПРАВИЛО ДОСТУПА — то же, что на сервере (PointsService.switchPoint) и в
 * мобилке (mobile/src/hooks/usePoints.ts): user_management выбирает из всех
 * автосервисов и может сбросить выбор в общую сводку, остальные — только из
 * назначенных им (без назначений не ограничены, безопасный дефолт 156).
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { clearPersistentCache } from '../utils/persistentCache';
import type { PointsListResponse, TenantPoint } from '../types';

/** Канонический ключ списка автосервисов — один слот кеша на всё приложение. */
export const POINTS_QUERY_KEY = ['points'] as const;

/**
 * Подпись режима «без выбранного автосервиса» — только у владельца/админа.
 * Не «Все точки»: у владельца это ДВА РАЗНЫХ автосервиса (основной и открытый
 * позже филиал), а не одна сеть точек.
 */
export const ALL_POINTS_LABEL = 'Все автосервисы';

/** Подпись, когда автосервис не выбран, а сводки по всем человеку не положено. */
export const NO_POINT_LABEL = 'Автосервис не выбран';

/** «Основной сервис» / «Филиал» — одна формулировка на все страницы. */
export function pointKindLabel(point: Pick<TenantPoint, 'isMain'>): string {
  return point.isMain ? 'Основной сервис' : 'Филиал';
}

/**
 * Порядок: основной сервис ПЕРВЫМ, дальше филиалы по sortOrder и имени.
 * Сервер отдаёт список уже так, но клиент его фильтрует (сотруднику остаются
 * только назначенные), и любая пересборка массива могла бы увести основной в
 * середину — там владелец не узнал бы строку, в которой лежит вся его
 * многолетняя выручка.
 */
function sortPoints(points: TenantPoint[]): TenantPoint[] {
  return [...points].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return a.name.localeCompare(b.name, 'ru');
  });
}

export interface PointAccess {
  /** Автосервисы, между которыми пользователь ВПРАВЕ переходить. Основной первым. */
  selectable: TenantPoint[];
  /** ОСНОВНОЙ сервис из доступных; null — доступны только филиалы. */
  mainPoint: TenantPoint | null;
  /** Доступные ФИЛИАЛЫ — всё, кроме основного сервиса. */
  branches: TenantPoint[];
  /** Текущий автосервис; null = общая сводка по всем. */
  currentPointId: string | null;
  currentPoint: TenantPoint | null;
  /** Право управлять назначениями сотрудников (и видеть общую сводку). */
  canManage: boolean;
  /** Доступен ли режим «Все автосервисы». */
  canSeeAllPoints: boolean;
  /**
   * Показывать ли индикатор и раздел «Филиалы». Не равно «автосервис один»: у
   * держателя user_management два режима даже с единственным филиалом — сам
   * автосервис и общая сводка, и цифры в них РАЗНЫЕ.
   */
  multiPoint: boolean;
  isLoading: boolean;
}

export function usePointAccess(): PointAccess {
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('user_management');

  const { data, isLoading } = useQuery<PointsListResponse>({
    queryKey: POINTS_QUERY_KEY,
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const points = data?.points ?? [];
    const assigned = user ? points.filter((p) => p.memberIds?.includes(user.id)) : [];
    const selectable = sortPoints(canManage || assigned.length === 0 ? points : assigned);
    // До первого ответа /points берём автосервис из уже загруженного профиля
    // (User.currentPointId из /auth/me) — иначе шапка секунду врёт «Все
    // автосервисы» там, где на самом деле выбран конкретный.
    const currentPointId = data ? data.currentPointId : (user?.currentPointId ?? null);
    return {
      selectable,
      mainPoint: selectable.find((p) => p.isMain) ?? null,
      branches: selectable.filter((p) => !p.isMain),
      currentPointId,
      currentPoint: currentPointId ? (points.find((p) => p.id === currentPointId) ?? null) : null,
      canManage,
      canSeeAllPoints: canManage,
      multiPoint: selectable.length > 1 || (canManage && points.length > 0),
      isLoading,
    };
  }, [data, user, canManage, isLoading]);
}

/**
 * Переход в другой автосервис — единственная точка входа (страница «Филиалы»).
 *
 * ПОЧЕМУ ЖЁСТКИЙ СБРОС, А НЕ ТОЧЕЧНАЯ ИНВАЛИДАЦИЯ. После перехода меняется
 * ответ практически КАЖДОГО денежного эндпоинта (журнал, дашборд, отчёты,
 * зарплата, смены, расходы, клиенты…). `resetQueries` (а не invalidate)
 * обнуляет данные, поэтому страница покажет загрузку, а НЕ цифры прошлого
 * автосервиса на время рефетча. Список автосервисов из сброса исключён —
 * иначе мигал бы сам индикатор.
 */
export function useSwitchPoint() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  const mutation = useMutation({
    mutationFn: async (pointId: string | null) => (await pointsApi.switch(pointId)).data,
    onSuccess: async (res) => {
      // Сервер мог ПОДСТАВИТЬ автосервис сам (сотруднику без user_management с
      // единственным доступным сброс схлопывается в него) — источник правды
      // именно ответ, а не то, что мы просили.
      const effective = res?.currentPointId ?? null;
      await queryClient.cancelQueries();
      queryClient.setQueryData<PointsListResponse>(POINTS_QUERY_KEY, (prev) =>
        prev ? { ...prev, currentPointId: effective } : prev,
      );
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== POINTS_QUERY_KEY[0] });
      // IndexedDB-снапшот (utils/persistentCache) писался БЕЗ автосервиса,
      // поэтому после перехода он весь принадлежит прошлому: без очистки
      // следующая загрузка страницы подняла бы чужих клиентов, чеки, смены и
      // зарплату как «свежие». Сброс кеша выше уже прошёл, так что повторная
      // запись персистера сохранит уже правильный (пустой) снимок.
      void clearPersistentCache();
      void queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
      // Персистентная сессия: без неё User.currentPointId остался бы прежним и
      // перезагрузка страницы снова показала бы прошлый автосервис.
      void refreshUser();
    },
  });

  const { mutateAsync } = mutation;
  const switchPoint = useCallback((pointId: string | null) => mutateAsync(pointId), [mutateAsync]);

  return { switchPoint, isSwitching: mutation.isPending };
}
