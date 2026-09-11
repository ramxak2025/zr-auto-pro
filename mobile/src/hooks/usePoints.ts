/**
 * usePoints — единственный источник правды об автосервисах владельца
 * (основной сервис + филиалы, мульти-точки 156/160/161/163) на клиенте.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Правило «кто какие автосервисы видит» повторялось в
 * трёх местах (чип на дашборде, пункт «Ещё», экран филиалов) и уже
 * разъезжалось. Разъезд в этой зоне стоит денег — заказ-наряд, пробитый не в
 * том автосервисе, уезжает в чужую выручку и чужую зарплату. Поэтому правило
 * доступа живёт здесь в одном экземпляре.
 *
 * ПЕРЕКЛЮЧЕНИЯ ФИЛИАЛА ЗДЕСЬ БОЛЬШЕ НЕТ И НЕ БУДЕТ (163). Филиал — свойство
 * СЕССИИ: он выбирается при входе (второй шаг, LoginPointSelect) и живёт ровно
 * столько, сколько живёт токен. Требование владельца дословно: «чтобы выйти и
 * войти в другой им надо опять выйти и войти в другой филиал». Поэтому:
 *   • ручки смены филиала на клиенте нет (сервер на POST /points/switch
 *     отвечает 409 — она осталась только для сборок 3.5/3.6);
 *   • раздел «Филиалы» показывает карточки с цифрами и предлагает ВЫЙТИ и
 *     войти в другой филиал, а не переключает молча;
 *   • на денежных экранах стоит НЕинтерактивный индикатор
 *     (components/PointIndicator) — он только показывает, где человек сейчас.
 *
 * ПРАВИЛО ДОСТУПА — ЗЕРКАЛО ФУНКЦИИ autexa_available_points (миграция 163):
 * есть назначения на живые филиалы (user_points) → доступны только они;
 * назначений нет вовсе → доступны все живые филиалы тенанта. Право
 * user_management здесь НИ ПРИ ЧЁМ: сервер при входе про него не спрашивает, и
 * добавь мы его сюда — владелец, назначенный на один филиал, видел бы кнопку
 * «войти» в филиал, куда сервер его не пустит.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { setOfflineCheckQueuePointId } from '../utils/offlineCheckQueue';
import type { PointsListResponse, TenantPoint } from '../../../shared/types';

/** Канонический ключ списка точек — один слот кеша на всё приложение. */
export const POINTS_QUERY_KEY = ['points'] as const;

/** «Основной сервис» / «Филиал» — одна формулировка на все экраны. */
export function pointKindLabel(point: Pick<TenantPoint, 'isMain'>): string {
  return point.isMain ? 'Основной сервис' : 'Филиал';
}

/**
 * Порядок автосервисов: основной ПЕРВЫМ, дальше филиалы по sortOrder и имени.
 *
 * Сервер отдаёт список уже в этом порядке, но клиент местами его фильтрует
 * (например, оставляет сотруднику только назначенные точки), и любая будущая
 * пересборка массива могла бы увести основной сервис в середину списка. Тогда
 * владелец увидел бы всю свою многолетнюю выручку строкой рядом с только что
 * открытым филиалом. Дешевле отсортировать явно.
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
 * = единая форма данных в кеше (та же дисциплина, что у useUsers) и один
 * сетевой запрос на весь экран. Ручка ЧИТАЮЩАЯ — она ничего не подставляет и
 * ничего не переключает (163).
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
  /**
   * Точки, в которые пользователь ВПРАВЕ войти (зеркало autexa_available_points).
   * Основной сервис первым. Войти = выйти из приложения и войти заново — внутри
   * приложения филиал не меняется.
   */
  selectable: TenantPoint[];
  /**
   * ОСНОВНОЙ сервис — сам автосервис владельца, которому принадлежит вся
   * история, заведённая до появления филиалов. null, если у тенанта его нет.
   */
  mainPoint: TenantPoint | null;
  /** ФИЛИАЛЫ — всё, кроме основного сервиса. */
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
   * одноточечного второго автосервиса не существует — ни выбора при входе, ни
   * раздела, ни индикатора он не видит и не должен (требование владельца).
   * Прежний второй критерий («держателю user_management показываем всегда»)
   * жил ради режима «Все филиалы» — режима больше нет, критерий ушёл вместе с
   * ним.
   */
  multiPoint: boolean;
  isLoading: boolean;
}

/**
 * ЧИСТОЕ правило доступа к филиалам — без react-query и без AuthContext,
 * поэтому покрывается юнит-тестом (hooks/__tests__/usePoints.test.ts).
 *
 * Поля входа:
 *   • `points` — живые точки тенанта из GET /points (может быть пусто);
 *   • `resolvedPointId` — филиал сессии ИЗ ОТВЕТА /points; `undefined` = ответа
 *     ещё нет, и тогда берётся `sessionPointId` (холодный старт: филиал уже
 *     лежит в персистентной сессии /auth/me, и индикатор обязан быть верным ДО
 *     первого ответа сети — иначе Касса секунду показывает не тот автосервис).
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
  const mainPoint = selectable.find((p) => p.isMain) ?? null;
  const branches = selectable.filter((p) => !p.isMain);
  const currentPointId = resolvedPointId !== undefined ? resolvedPointId : (sessionPointId ?? null);
  const currentPoint = currentPointId ? (points.find((p) => p.id === currentPointId) ?? null) : null;
  return {
    points,
    selectable,
    mainPoint,
    branches,
    currentPointId,
    currentPoint,
    canManage,
    multiPoint: points.length > 1,
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
