/**
 * usePoints — единственный источник правды об автосервисах владельца
 * (основной сервис + филиалы, мульти-точки 156/160/161/163) в вебе.
 *
 * ФИЛИАЛ — СВОЙСТВО СЕССИИ (163). Он лежит в подписанном токене и живёт ровно
 * столько, сколько живёт токен. Раньше филиал хранился на сервере в карточке
 * ПОЛЬЗОВАТЕЛЯ (users.current_point_id), поэтому веб молча наследовал филиал,
 * выбранный в телефоне: владелец за компьютером видел цифры одного автосервиса
 * и считал их цифрами обоих. Теперь веб-сессия не может уехать вслед за
 * мобильной — филиал меняется только явным действием человека.
 *
 * ЭТОТ ХУК НИЧЕГО НЕ ПЕРЕКЛЮЧАЕТ И НЕ ПОДСТАВЛЯЕТ. Он только читает GET /points.
 * Сам переход живёт ровно в одном месте — в разделе «Филиалы»
 * (pages/PointsPage), и там же выбирается его способ:
 *   • руководитель (право user_management) переходит мгновенно, перевыпуском
 *     сессии (POST /auth/switch-point, 167) — без повторного ввода пароля;
 *   • сотрудник — выходом и входом с выбором филиала на экране входа (163).
 * Устаревшая ручка POST /points/switch отсюда не зовётся вовсе: с 165 она лишь
 * запоминает подсказку для следующего входа и оставлена ради сборок 3.5/3.6.
 * В шапке стоит НЕинтерактивный индикатор (components/PointIndicator) — он
 * только показывает, где человек сейчас работает.
 *
 * ПРАВИЛО ДОСТУПА — ЗЕРКАЛО ФУНКЦИИ autexa_available_points (миграция 163) и
 * мобильного hooks/usePoints.ts: есть назначения на живые филиалы (user_points)
 * → доступны только они; назначений нет вовсе → доступны все живые филиалы
 * тенанта. Право user_management в ЭТОТ расчёт не входит: оно решает лишь,
 * каким СПОСОБОМ человек перейдёт (мгновенно или через вход), а не КУДА его
 * пустят. Смешай мы эти два вопроса — владелец, назначенный на один филиал,
 * видел бы кнопку перехода в филиал, куда сервер его не пустит.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { PointsListResponse, TenantPoint } from '../types';

/** Канонический ключ списка автосервисов — один слот кеша на всё приложение. */
export const POINTS_QUERY_KEY = ['points'] as const;

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

/**
 * GET /points. Ходить в pointsApi.list() напрямую больше не нужно: единый ключ
 * = единая форма данных в кеше и один сетевой запрос на страницу. Ручка
 * ЧИТАЮЩАЯ — она ничего не подставляет и ничего не переключает (163).
 */
export function usePointsQuery() {
  return useQuery<PointsListResponse>({
    queryKey: POINTS_QUERY_KEY,
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  });
}

export interface PointAccess {
  /** Все живые автосервисы тенанта (может быть больше, чем доступно человеку). */
  points: TenantPoint[];
  /**
   * Автосервисы, в которые пользователь ВПРАВЕ перейти (зеркало
   * autexa_available_points). Основной первым. Каким способом он туда попадёт —
   * мгновенным перевыпуском сессии (право user_management, 167) или выходом и
   * входом (163) — решает раздел «Филиалы»; на сам список это не влияет.
   */
  selectable: TenantPoint[];
  /** ОСНОВНОЙ сервис из доступных; null — доступны только филиалы. */
  mainPoint: TenantPoint | null;
  /** Доступные ФИЛИАЛЫ — всё, кроме основного сервиса. */
  branches: TenantPoint[];
  /**
   * Филиал ТЕКУЩЕЙ СЕССИИ. null = у тенанта нет живых филиалов (одноточечный
   * автосервис) либо ответ ещё не пришёл и в сессии филиала нет.
   */
  currentPointId: string | null;
  currentPoint: TenantPoint | null;
  /** Право настраивать доступ сотрудников к филиалам (карточка сотрудника). */
  canManage: boolean;
  /**
   * Показывать ли индикатор автосервиса и раздел «Филиалы».
   *
   * Ровно один критерий: у тенанта БОЛЬШЕ ОДНОГО живого автосервиса. У
   * одноточечного второго не существует — ни выбора при входе, ни раздела, ни
   * индикатора он не видит и не должен (требование владельца). Прежний второй
   * критерий («держателю user_management показываем всегда») жил ради режима
   * «Все филиалы» — режима больше нет, критерий ушёл вместе с ним.
   */
  multiPoint: boolean;
  isLoading: boolean;
}

/**
 * ЧИСТОЕ правило доступа к филиалам — без react-query и без AuthContext.
 *
 * Поля входа:
 *   • `points` — живые точки тенанта из GET /points (может быть пусто);
 *   • `resolvedPointId` — филиал сессии ИЗ ОТВЕТА /points; `undefined` = ответа
 *     ещё нет, и тогда берётся `sessionPointId` (холодный старт: филиал уже
 *     лежит в профиле из /auth/me, и индикатор обязан быть верным ДО первого
 *     ответа сети — иначе касса секунду показывает не тот автосервис).
 *     Оба источника — ОДИН И ТОТ ЖЕ токен, поэтому разойтись они не могут.
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
  const selectable = sortPoints(assigned.length > 0 ? assigned : points);
  const currentPointId = resolvedPointId !== undefined ? resolvedPointId : (sessionPointId ?? null);
  return {
    points,
    selectable,
    mainPoint: selectable.find((p) => p.isMain) ?? null,
    branches: selectable.filter((p) => !p.isMain),
    currentPointId,
    currentPoint: currentPointId ? (points.find((p) => p.id === currentPointId) ?? null) : null,
    canManage,
    multiPoint: points.length > 1,
    isLoading,
  };
}

export function usePointAccess(): PointAccess {
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('user_management');
  const { data, isLoading } = usePointsQuery();
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
