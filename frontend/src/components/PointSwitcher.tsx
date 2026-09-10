import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { clearPersistentCache } from '../utils/persistentCache';
import type { PointsListResponse } from '../types';

/**
 * PointSwitcher — индикатор текущего филиала и переключатель для веба
 * (мульти-точки 156/160/161).
 *
 * ПОЧЕМУ ОН НУЖЕН ВЕБУ. Текущий филиал хранится НА СЕРВЕРЕ (users.current_point_id)
 * и приезжает в JWT-акторе, поэтому веб и так фильтровал журнал, кассу и отчёты
 * по филиалу, выбранному в телефоне, — молча, без индикатора и без способа
 * переключиться. Владелец за компьютером видел цифры одной точки и считал их
 * цифрами всей сети.
 *
 * ПРАВИЛО ДОСТУПА — то же, что на сервере (PointsService.switchPoint) и в
 * мобилке (hooks/usePoints): user_management выбирает из всех точек и может
 * сбросить выбор в «Все точки», остальные — только из назначенных им (без
 * назначений не ограничены, безопасный дефолт 156).
 *
 * КОГДА ИНДИКАТОР НЕ РИСУЕТСЯ: переключать нечего. Это НЕ равно «филиал один»:
 * у держателя user_management даже с единственной точкой два режима — сам
 * филиал и «Все точки» (сводка по сети), и цифры в них РАЗНЫЕ. Пока индикатор
 * прятался, владелец не понимал, в каком он режиме, и не мог выйти из «Всех
 * точек» — при том что денежная запись в этом режиме упирается в 400
 * «Выберите филиал». Поэтому: больше одной доступной точки ИЛИ user_management
 * при хотя бы одной точке у тенанта.
 */
export default function PointSwitcher() {
  const { user, hasPermission, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<PointsListResponse>({
    queryKey: ['points'],
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  });

  const canManage = hasPermission('user_management');
  const points = useMemo(() => data?.points ?? [], [data]);
  const selectable = useMemo(() => {
    const assigned = user ? points.filter((p) => p.memberIds?.includes(user.id)) : [];
    return canManage || assigned.length === 0 ? points : assigned;
  }, [points, user, canManage]);

  // До первого ответа /points берём филиал из уже загруженного профиля
  // (User.currentPointId из /auth/me) — иначе шапка секунду врёт «Все точки».
  const currentPointId = data ? data.currentPointId : (user?.currentPointId ?? null);
  const currentPoint = currentPointId ? (points.find((p) => p.id === currentPointId) ?? null) : null;

  const switchMutation = useMutation({
    mutationFn: async (pointId: string | null) => (await pointsApi.switch(pointId)).data,
    onSuccess: async (res) => {
      const effective = res?.currentPointId ?? null;
      // Смена филиала меняет ответ практически каждого денежного эндпоинта.
      // `resetQueries` (а не invalidate) обнуляет данные, поэтому страница
      // покажет загрузку, а не цифры прошлого филиала на время рефетча.
      // Список точек из сброса исключён — иначе мигал бы сам индикатор.
      await queryClient.cancelQueries();
      queryClient.setQueryData<PointsListResponse>(['points'], (prev) =>
        prev ? { ...prev, currentPointId: effective } : prev,
      );
      void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== 'points' });
      // IndexedDB-снапшот (utils/persistentCache) писался БЕЗ филиала, поэтому
      // после переключения он весь принадлежит прошлой точке: без очистки
      // следующая загрузка страницы подняла бы чужие клиентов, чеки, смены и
      // зарплату как «свежие». Сброс кеша выше уже прошёл, так что повторная
      // запись персистера сохранит уже правильный (пустой) снимок.
      void clearPersistentCache();
      void queryClient.invalidateQueries({ queryKey: ['points'] });
      void refreshUser();
    },
  });

  const choose = useCallback(
    (pointId: string | null) => {
      setOpen(false);
      if (pointId === currentPointId) return;
      switchMutation.mutate(pointId);
    },
    [currentPointId, switchMutation],
  );

  if (selectable.length <= 1 && !(canManage && points.length > 0)) return null;

  // «Все точки» на денежных страницах — не нейтральное состояние: новый
  // заказ-наряд уйдёт без филиала. Подсвечиваем янтарным.
  const noPointChosen = currentPointId === null;
  const label = currentPoint?.name ?? (canManage ? 'Все точки' : 'Филиал не выбран');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switchMutation.isPending}
        className={`flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
          noPointChosen
            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
        title={`Филиал: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {switchMutation.isPending ? (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
        ) : noPointChosen ? (
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        ) : (
          <Building2 className="h-4 w-4 flex-shrink-0" />
        )}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <>
          {/* Клик мимо закрывает список — отдельный слой вместо слушателя на
              document: он не конфликтует с модалками страниц. Именно кнопка,
              а не div: так слой закрывается и с клавиатуры. */}
          <button
            type="button"
            aria-label="Закрыть выбор филиала"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          >
            {selectable.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === currentPointId}
                onClick={() => choose(p.id)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50"
              >
                <Check
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 ${p.id === currentPointId ? 'text-primary-600' : 'text-transparent'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{p.name}</span>
                  {p.address && <span className="block truncate text-xs text-gray-500">{p.address}</span>}
                </span>
              </button>
            ))}
            {canManage && (
              <button
                type="button"
                role="option"
                aria-selected={currentPointId === null}
                onClick={() => choose(null)}
                className="flex w-full items-start gap-2 border-t border-gray-100 px-3 py-2 text-left transition-colors hover:bg-gray-50"
              >
                <Check
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 ${currentPointId === null ? 'text-primary-600' : 'text-transparent'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">Все точки</span>
                  {/* Честная подпись: сервер денежную запись без филиала
                      больше не принимает — подставит единственную доступную
                      точку либо ответит «Выберите филиал, …». */}
                  <span className="block text-xs text-gray-500">
                    Сводка по сети — для просмотра. Для кассы, расходов и зарплаты нужно выбрать филиал.
                  </span>
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
