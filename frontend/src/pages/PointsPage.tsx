import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Archive, ArrowRightLeft, Building2, Check, Home, LogIn, Users } from 'lucide-react';

import { pointsApi } from '../api/services';
import { endSessionWithNotice } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { POINTS_QUERY_KEY, pointKindLabel, usePointAccess, usePointsQuery } from '../hooks/usePoints';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Money, PageHeader, Skeleton, SkeletonCard, cn } from '../ui';
import { toneChip } from '../ui/tokens';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import { buildPointCardRows, type PointCardRow } from '../../../shared/utils/pointCards';
import { resolveSwitchPointFailure } from '../utils/switchPointFailure';
import { readOfflineQueueState } from '../utils/swCache';
import {
  isOfflineQueueBlockedError,
  pendingQueueLogoutWarning,
  pendingQueueSwitchNotice,
  queueBlockMessage,
} from '../utils/offlineQueueSwitch';
import type { PointsListResponse, PointsSummaryResponse, TenantPoint } from '../types';

/**
 * PointsPage — раздел «Филиалы» в вебе: основной автосервис владельца и
 * открытые им филиалы (мульти-точки 156/160/161/163/167).
 *
 * ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ МЕНЯЕТСЯ ФИЛИАЛ. Требование владельца: переходить
 * между автосервисами только отсюда — ни из шапки, ни с главной, ни жестом.
 * Филиал остаётся свойством СЕССИИ: он лежит в подписанном токене и определяет,
 * в какой автосервис уходят деньги, склад и смены.
 *
 * ДВА СЦЕНАРИЯ ПЕРЕХОДА — по праву `user_management`:
 *
 *   • РУКОВОДИТЕЛЬ (владелец, директор, админ сети) переходит МГНОВЕННО (167):
 *     кнопка «Перейти в этот филиал» зовёт POST /auth/switch-point. Это не вход
 *     без пароля и не повышение прав: личность подтверждена живой сессией, а
 *     сервер перепроверяет и право, и доступ к целевому филиалу. Технически это
 *     ПЕРЕВЫПУСК сессии — новый токен с новым филиалом, прежний гаснет сразу;
 *
 *   • СОТРУДНИК меняет филиал ВЫХОДОМ И ВХОДОМ, как и раньше (163). У него
 *     филиал определяет, куда уходят ЕГО деньги (зарплата считается по филиалу
 *     смены), и случайная смена стоит дороже неудобства. Поэтому ему кнопка
 *     мгновенного перехода не показывается вовсе, а «Войти в этот филиал»
 *     честно предупреждает, что сессия завершится.
 *
 * РЕЖИМА «ВСЕ ФИЛИАЛЫ» БОЛЬШЕ НЕТ. Сессия всегда принадлежит ровно одному
 * автосервису, поэтому карточки на этой странице — это СВОДКА по сети (взгляд
 * сверху), а не режим работы. Так по построению исчезает класс ошибок «деньги
 * записаны без филиала и не видны ни в одном» — тот самый, из-за которого
 * зарплату можно было выдать дважды.
 *
 * ЧЕМ ОСНОВНОЙ СЕРВИС ОТЛИЧАЕТСЯ ОТ ФИЛИАЛА (160, tenant_points.is_main):
 * основной — это САМ автосервис владельца, ему принадлежит вся история,
 * заведённая до появления филиалов, и назван он по названию компании. Ровно
 * один такой у тенанта, сервер отдаёт его первым. Поэтому он идёт отдельной
 * секцией сверху.
 *
 * КТО ВИДИТ ЧТО:
 *   • список — любой сотрудник тенанта, у которого больше одного автосервиса;
 *   • переход (мгновенный или через вход) — только в филиалы, куда человека
 *     пускает сервер (usePointAccess.selectable — зеркало autexa_available_points);
 *   • деньги — GET /points/summary под ключом `financial_reports`; прибыль
 *     внутри дополнительно закрыта `profit_view` (без права сервер отдаёт 0,
 *     поэтому строку не рисуем вовсе — ноль выглядел бы как настоящий убыток);
 *   • состав филиала — ТОЛЬКО ДЛЯ ПРОСМОТРА. Настройка «на каких филиалах
 *     может работать сотрудник» живёт в карточке сотрудника («Пользователи» →
 *     «Филиалы сотрудника»): это ответ на вопрос про ЧЕЛОВЕКА.
 *
 * ЗАКРЫТЫЙ ФИЛИАЛ ТОЖЕ ПОЛУЧАЕТ КАРТОЧКУ. Список строится по СВОДКЕ
 * (buildPointCardRows), а не по одному лишь живому GET /points: деньги
 * закрытого филиала остаются в итогах тенанта, и без карточки владелец читал
 * бы расхождение с главной как пропажу денег. Такая карточка подписана
 * «Закрыт», приглушена, стоит ПОСЛЕ действующих и НЕ предлагает войти.
 *
 * Автосервисы заводит и архивирует только суперадмин — здесь их не создают.
 */
export default function PointsPage() {
  const { hasPermission, logout, switchPoint, refreshUser } = useAuth();
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');
  /**
   * Показывать ли мгновенный переход. Право `user_management` — тот же ключ, по
   * которому пускает сервер (он перепроверяет его сам). Клиентский гейт нужен
   * ровно для одного: не показывать сотруднику кнопку, которая ответит ему
   * отказом, — вместо неё он видит честное «выйти и войти».
   */
  const canSwitchInstantly = hasPermission('user_management');

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { points, selectable, currentPointId, isLoading } = usePointAccess();
  // Тот же слот ['points'] — только ради isError/refetch, лишнего запроса нет.
  const pointsQuery = usePointsQuery();

  const canEnter = (pointId: string) => selectable.some((p) => p.id === pointId);

  // Имя филиала, в котором человек работает ПРЯМО СЕЙЧАС. Нужно во всех
  // текстах про офлайн-очередь: обещание «уйдут в ваш филиал» без названия —
  // это не обещание, а общие слова.
  const currentPointName = points.find((p) => p.id === currentPointId)?.name ?? null;

  // Филиал, в который человек попросился войти ЧЕРЕЗ ВЫХОД: держим до
  // подтверждения — выход из аккаунта нельзя делать по одному клику. Вместе с
  // филиалом держим замер очереди на момент открытия диалога: выход её СТИРАЕТ,
  // и человек должен узнать об этом до, а не после.
  const [enterTarget, setEnterTarget] = useState<{ point: TenantPoint; pending: number } | null>(null);
  // Филиал, для которого человек подтверждает МГНОВЕННЫЙ переход при непустой
  // очереди (167-web). Пустая очередь сюда не попадает вовсе — там переход
  // мгновенный, без единого вопроса.
  const [switchTarget, setSwitchTarget] = useState<{ point: TenantPoint; pending: number } | null>(null);
  // Филиал, в который прямо сейчас идёт мгновенный переход (167). Пока он не
  // null, ВСЕ кнопки перехода выключены — второй клик по соседней карточке
  // отправил бы второй перевыпуск сессии, и какой из двух токенов окажется
  // живым, зависело бы от гонки ответов.
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // ТОТ ЖЕ ЗАПРЕТ, НО СИНХРОННЫЙ: между нажатием и запросом есть await (замер
  // офлайн-очереди), и два быстрых клика проскочили бы, увидев в замыкании ещё
  // пустой switchingId. Ref выставляется ДО первого await и потому не проскакивает.
  const switchBusyRef = useRef(false);
  // Отказ сервера при переходе. Держим на экране, а не показываем тостом:
  // тост уезжает через три секунды, а «Мгновенное переключение доступно только
  // руководителю» — это инструкция, которую человек должен успеть прочитать.
  const [switchError, setSwitchError] = useState<string | null>(null);

  const summaryQuery = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });
  const summaryData = summaryQuery.data;

  /**
   * МГНОВЕННЫЙ ПЕРЕХОД (167). Сервер перевыпускает сессию, AuthContext.switchPoint
   * применяет новый токен и стирает все кеши — ровно как после входа. Дальше
   * уводим на главную: она первой покажет цифры нового филиала.
   *
   * ОФЛАЙН-ОЧЕРЕДЬ РЕШАЕТСЯ ВНУТРИ switchPoint: он доигрывает её под СТАРЫМ
   * токеном и отказывается менять филиал, если что-то осталось. Здесь мы ловим
   * этот отказ отдельно от серверных — у него другая причина и другой ответ
   * человеку («ваши чеки на месте, вы остались там же»).
   */
  const handleSwitch = async (point: TenantPoint) => {
    if (switchBusyRef.current) return; // защита от двойного нажатия
    switchBusyRef.current = true;
    setSwitchingId(point.id);
    setSwitchError(null);
    try {
      await switchPoint(point.id);
      // Индикатор филиала в шапке обязан показать новый автосервис СРАЗУ, а не
      // через сетевой ответ. Переход стирает все кеши (иначе мелькнут цифры
      // прежнего филиала), и вместе с ними пропадает справочник точек.
      // Справочник филиалов — данные ТЕНАНТА (имена, адреса, состав), они
      // одинаковы во всех филиалах и чужими деньгами быть не могут, поэтому
      // класть их обратно безопасно. Прогрев из commitSession уже в пути.
      queryClient.setQueryData<PointsListResponse>(POINTS_QUERY_KEY, { points, currentPointId: point.id });
      setSwitchingId(null);
      toast.success(`Вы перешли в «${point.name}»`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (isOfflineQueueBlockedError(err)) {
        // Сессия НЕ тронута: филиал прежний, токен прежний, очередь на диске цела.
        setSwitchError(queueBlockMessage(err.verdict, currentPointName));
        setSwitchingId(null);
        return;
      }
      const failure = resolveSwitchPointFailure(err);
      if (failure.action === 'relogin') {
        // Сессия действительно мертва (токен отозван, аккаунт уволен): второй
        // попытки нет. Уводим на вход, показав причину. Кнопки НАМЕРЕННО
        // остаются выключенными: до перезагрузки нажимать здесь больше нечего.
        endSessionWithNotice(failure.message);
        return;
      }
      if (failure.action === 'refresh') {
        // Отказ по ПРАВИЛУ (403), сессия жива. Перечитываем список филиалов и
        // профиль: доступ к филиалу сняли или право забрали прямо сейчас, и
        // интерфейс обязан перестать предлагать действие, которого больше нет.
        void queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ['points-summary'] });
        void refreshUser();
      }
      setSwitchError(failure.message);
      setSwitchingId(null);
    } finally {
      // Снимаем синхронный запрет ВСЕГДА. На ветке `relogin` кнопки остаются
      // выключенными сами — там switchingId намеренно не сбрасывается.
      switchBusyRef.current = false;
    }
  };

  /**
   * НАЖАТИЕ «ПЕРЕЙТИ В ЭТОТ ФИЛИАЛ» — развилка по офлайн-очереди (167-web):
   * очередь пуста → переходим СРАЗУ; в очереди что-то есть → спрашиваем.
   * Замер best-effort: отказ диска даёт ноль и НЕ запрещает переход — реальную
   * гарантию всё равно держит switchPoint.
   */
  const requestSwitch = async (point: TenantPoint) => {
    if (switchBusyRef.current) return;
    setSwitchError(null);

    let pending = 0;
    try {
      pending = (await readOfflineQueueState()).pending;
    } catch {
      pending = 0;
    }
    // Пока читали диск, переход мог начаться со второго нажатия.
    if (switchBusyRef.current) return;

    if (pending <= 0) {
      void handleSwitch(point);
      return;
    }
    setSwitchTarget({ point, pending });
  };

  /**
   * НАЖАТИЕ «ВОЙТИ В ЭТОТ ФИЛИАЛ» (путь сотрудника: выход и вход заново).
   * Замеряем очередь ради честного предупреждения: выход из аккаунта её СТИРАЕТ.
   */
  const requestEnter = async (point: TenantPoint) => {
    let pending = 0;
    try {
      pending = (await readOfflineQueueState()).pending;
    } catch {
      pending = 0;
    }
    setEnterTarget({ point, pending });
  };

  // Карточки строим по ВСЕМ автосервисам тенанта — живым и закрытым с деньгами
  // в периоде, — а не только по доступным этому человеку: сводка по сети это
  // взгляд сверху. Действие «Войти» при этом появляется только там, куда сервер
  // пустит. Правило сборки и порядок — общие с мобилкой (shared/utils/pointCards).
  const rows = useMemo(() => buildPointCardRows({ points, summary: summaryData?.points ?? [] }), [points, summaryData]);

  // Основной сервис — отдельной секцией сверху. Закрытым он быть не может
  // (API запрещает архивировать основной), но проверку держим явной.
  const mainRow = rows.find((r) => r.isMain && !r.isArchived) ?? null;
  const branchRows = rows.filter((r) => r !== mainRow);

  const renderCard = (row: PointCardRow) => (
    <PointCard
      key={row.pointId}
      row={row}
      summaryLoading={summaryQuery.isLoading && !summaryData}
      summaryError={summaryQuery.isError && !summaryData}
      onSummaryRetry={() => summaryQuery.refetch()}
      summaryFetching={summaryQuery.isFetching}
      canSeeMoney={canSeeMoney}
      canSeeProfit={canSeeProfit}
      isCurrent={row.pointId === currentPointId}
      // Перейти можно только в ЖИВОЙ филиал, куда пускает сервер. У закрытого
      // живой записи нет вовсе — и входить в него некуда.
      canEnter={!row.isArchived && row.point !== null && canEnter(row.pointId)}
      canSwitchInstantly={canSwitchInstantly}
      switching={switchingId === row.pointId}
      // Пока идёт один переход, остальные кнопки выключены: два перевыпуска
      // сессии подряд — это гонка за то, какой токен останется живым.
      switchBlocked={switchingId !== null && switchingId !== row.pointId}
      onEnter={() => {
        if (row.point) void requestEnter(row.point);
      }}
      onSwitch={() => {
        if (row.point) void requestSwitch(row.point);
      }}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Филиалы" icon={Building2} subtitle="Основной сервис и филиалы — сводка по сети" />

      {isLoading && rows.length === 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard lines={3} className="md:col-span-2 xl:col-span-3" />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      ) : pointsQuery.isError && rows.length === 0 ? (
        <ErrorRow
          message="Не удалось загрузить список филиалов"
          onRetry={() => pointsQuery.refetch()}
          loading={pointsQuery.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Пока нет филиалов"
          description="Дополнительный автосервис заводит суперадмин в панели управления."
        />
      ) : (
        <>
          {/* Объяснение модели первым экраном: это не «главная и её придаток»,
              а самостоятельные автосервисы одного владельца. Вторая фраза
              разная: руководителю переход стоит одного нажатия, сотруднику —
              выхода и входа, и обещать ему лёгкий переход нельзя. */}
          <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
            Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
            зарплата. Вы работаете в том филиале, который выбран в этой сессии;{' '}
            {canSwitchInstantly
              ? 'перейти в другой можно прямо здесь — данные перезагрузятся под новый филиал.'
              : 'чтобы перейти в другой, нужно выйти и войти заново.'}
          </p>

          {switchError && (
            <p
              role="alert"
              className="rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-sm leading-relaxed text-bad-text"
            >
              {switchError}
            </p>
          )}

          {mainRow && (
            <section aria-labelledby="points-main" className="space-y-2">
              <h2 id="points-main" className="text-xs font-semibold text-ink-3">
                Основной сервис
              </h2>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{renderCard(mainRow)}</div>
            </section>
          )}

          {branchRows.length > 0 && (
            <section aria-labelledby="points-branches" className="space-y-2">
              <h2 id="points-branches" className="text-xs font-semibold text-ink-3">
                {branchRows.length === 1 ? 'Филиал' : 'Филиалы'}
              </h2>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{branchRows.map(renderCard)}</div>
            </section>
          )}
        </>
      )}

      {/*
        «Войти в этот филиал» = ВЫЙТИ и войти заново. Этот путь остаётся у
        сотрудника: мгновенный перевыпуск сессии сервер разрешает только
        держателю права управления персоналом (167). Отсюда и честное
        предупреждение: страница выйдет из аккаунта, всё незавершённое будет
        потеряно, и понадобится ввести пароль.
      */}
      <ConfirmDialog
        isOpen={!!enterTarget}
        onClose={() => setEnterTarget(null)}
        onConfirm={() => {
          // logout() гасит токен и чистит все кеши, поэтому после входа в
          // другой филиал на экранах не мелькнут цифры этого.
          logout();
        }}
        title={enterTarget ? `Войти в «${enterTarget.point.name}»?` : ''}
        message={
          'Филиал выбирается при входе, поэтому сейчас произойдёт выход из аккаунта. Введите телефон и пароль ещё раз ' +
          'и выберите этот филиал в списке. Незавершённые заказ-наряды будут потеряны.' +
          // Про офлайн-очередь говорим отдельной фразой и только когда в ней что-то есть.
          pendingQueueLogoutWarning(enterTarget?.pending ?? 0)
        }
        confirmText="Выйти и войти"
        variant="danger"
      />

      {/*
        МГНОВЕННЫЙ ПЕРЕХОД ПРИ НЕПУСТОЙ ОФЛАЙН-ОЧЕРЕДИ (167-web). Появляется
        ТОЛЬКО когда на устройстве есть неотправленное. Подтверждение означает
        «сначала отправь, потом переходи» — кнопка названа действием целиком.
      */}
      <ConfirmDialog
        isOpen={!!switchTarget}
        onClose={() => setSwitchTarget(null)}
        onConfirm={() => {
          if (switchTarget) void handleSwitch(switchTarget.point);
        }}
        title={switchTarget ? `Перейти в «${switchTarget.point.name}»?` : ''}
        message={
          switchTarget ? pendingQueueSwitchNotice(switchTarget.pending, currentPointName, switchTarget.point.name) : ''
        }
        confirmText="Отправить и перейти"
      />
    </div>
  );
}

function PointCard({
  row,
  summaryLoading,
  summaryError,
  onSummaryRetry,
  summaryFetching,
  canSeeMoney,
  canSeeProfit,
  isCurrent,
  canEnter,
  canSwitchInstantly,
  switching,
  switchBlocked,
  onEnter,
  onSwitch,
}: {
  row: PointCardRow;
  summaryLoading: boolean;
  summaryError: boolean;
  onSummaryRetry: () => void;
  summaryFetching: boolean;
  canSeeMoney: boolean;
  canSeeProfit: boolean;
  isCurrent: boolean;
  /** Пустит ли сервер этого человека в этот филиал (user_points, 163). */
  canEnter: boolean;
  /** Есть ли у человека право на мгновенный переход без пароля (167). */
  canSwitchInstantly: boolean;
  /** Переход именно в ЭТОТ филиал уже идёт. */
  switching: boolean;
  /** Идёт переход в ДРУГОЙ филиал — эта кнопка на время выключена. */
  switchBlocked: boolean;
  onEnter: () => void;
  onSwitch: () => void;
}) {
  const { point, summary, isArchived } = row;
  const kind = pointKindLabel(row);
  // Дом = сам автосервис владельца, здание = открытый позже филиал.
  const Icon = row.isMain ? Home : Building2;
  const memberCount = point?.memberIds?.length ?? 0;
  const mastersOnShift =
    summary && summary.mastersOnShift !== null && summary.mastersOnShift !== undefined
      ? String(summary.mastersOnShift)
      : '—';

  return (
    <Card
      as="article"
      padding="none"
      aria-label={`${kind}: ${row.name}`}
      className={cn(
        'flex flex-col',
        // Закрытый филиал приглушён и не выделен рамкой: цифры внутри остаются
        // читаемыми — ради них карточка и есть. Текущий — акцентная рамка.
        isArchived ? 'opacity-80 shadow-none' : isCurrent ? 'border-accent/50 ring-1 ring-accent/30' : '',
      )}
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
            isArchived ? toneChip.neutral : isCurrent ? 'bg-accent text-white' : toneChip.accent,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate text-md font-semibold', isArchived ? 'text-ink-2' : 'text-ink')}>{row.name}</h3>
          <p className="truncate text-xs text-ink-3">{row.address ? `${kind} · ${row.address}` : kind}</p>
        </div>
        {/* «Закрыт» важнее «Вы здесь»: человек, оставшийся в сессии закрытого
            филиала, обязан в первую очередь узнать, что филиала больше нет. */}
        {isArchived ? (
          <Badge icon={Archive}>Закрыт</Badge>
        ) : (
          isCurrent && (
            <Badge tone="accent" icon={Check}>
              Вы здесь
            </Badge>
          )
        )}
      </div>

      {canSeeMoney && (
        <div className="px-5 pt-4">
          {summaryLoading && !summary ? (
            <div className="grid grid-cols-2 gap-3" role="status" aria-label="Загрузка сводки…">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : summaryError && !summary ? (
            <ErrorRow message="Сводка не загрузилась" onRetry={onSummaryRetry} loading={summaryFetching} />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <MiniStat
                size="sm"
                label="Оборот за день"
                value={summary ? <Money value={summary.revenueToday} /> : '—'}
              />
              <MiniStat
                size="sm"
                label="Оборот за месяц"
                value={summary ? <Money value={summary.revenueMonth} /> : '—'}
              />
              {canSeeProfit && (
                <MiniStat
                  size="sm"
                  label="Прибыль за месяц"
                  value={summary ? <Money value={summary.profitMonth} colorize /> : '—'}
                />
              )}
              {/* mastersOnShift === null — учёт смен у тенанта ВЫКЛЮЧЕН, факта
                  не существует. Рисуем прочерк: «0» прочиталось бы как «сегодня
                  никто не вышел». */}
              <MiniStat size="sm" label="Мастеров на работе" value={mastersOnShift} />
            </div>
          )}
        </div>
      )}

      {/* Состав филиала — СПРАВОЧНО. Настраивается в карточке сотрудника, и
          подпись обязана об этом сказать. У закрытого филиала состава нет. */}
      {point && !isArchived && (
        <p className="flex items-start gap-1.5 px-5 pt-4 text-xs text-ink-3">
          <Users className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            {memberCount > 0
              ? `Закреплены: ${memberCount} — настраивается в карточке сотрудника`
              : 'Никто не закреплён — доступен всем сотрудникам'}
          </span>
        </p>
      )}

      <div className="mt-auto px-5 pb-5 pt-4">
        {isArchived ? (
          // Действия «Войти» здесь НЕ БЫВАЕТ: филиал заархивирован, сервер в него
          // не пустит. Карточка существует ради денег периода.
          <p className="flex items-center justify-center gap-2 rounded-lg bg-surface-3 px-4 py-2.5 text-center text-xs font-medium text-ink-2">
            <Archive className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {isCurrent ? 'Филиал закрыт. Вы работаете в нём до выхода' : 'Филиал закрыт — войти нельзя'}
          </p>
        ) : isCurrent ? (
          <p className="flex items-center justify-center gap-2 rounded-lg bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent-text">
            <Check className="h-4 w-4" aria-hidden="true" />
            Вы работаете здесь
          </p>
        ) : canEnter && canSwitchInstantly ? (
          // МГНОВЕННЫЙ ПЕРЕХОД (167) — руководителю. Одно нажатие: сервер
          // перевыпускает сессию, клиент меняет токен и перезагружает все данные.
          <Button
            variant="secondary"
            fullWidth
            icon={ArrowRightLeft}
            onClick={onSwitch}
            disabled={switchBlocked}
            loading={switching}
            aria-label={`Перейти в автосервис ${row.name} — данные загрузятся заново`}
          >
            Перейти в этот филиал
          </Button>
        ) : canEnter ? (
          // СОТРУДНИК: филиал меняется выходом и входом (163).
          <Button
            variant="secondary"
            fullWidth
            icon={LogIn}
            onClick={onEnter}
            aria-label={`Войти в автосервис ${row.name} — потребуется выйти и войти заново`}
          >
            Войти в этот филиал
          </Button>
        ) : (
          // Филиал виден в сводке, но войти в него нельзя: сотруднику не выдан доступ.
          <p className="rounded-lg bg-surface-2 px-4 py-2.5 text-center text-xs text-ink-3">
            Вход в этот филиал вам не открыт — доступ настраивает владелец в карточке сотрудника.
          </p>
        )}
      </div>
    </Card>
  );
}
