import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Archive, ArrowRightLeft, Building2, Home, Check, LogIn, Loader2, Users } from 'lucide-react';

import { pointsApi } from '../api/services';
import { endSessionWithNotice } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { usePointAccess, pointKindLabel, POINTS_QUERY_KEY } from '../hooks/usePoints';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatMoney } from '../../../shared/utils/formatters';
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
 *     ПЕРЕВЫПУСК сессии — новый токен с новым филиалом, прежний гаснет сразу,
 *     поэтому перехваченный старый токен не остаётся рабочим;
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
 * секцией сверху: строкой вровень с только что открытым филиалом владелец не
 * понял бы, где лежит его многолетняя выручка.
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
 * (buildPointCardRows), а не по одному лишь живому GET /points. Пока карточки
 * брались только из живых точек, деньги закрытого филиала оставались в итогах
 * тенанта, а карточки для них не существовало: владелец складывал карточки, не
 * получал цифру с главной и читал это как пропажу денег. Такая карточка
 * подписана «Закрыт», нарисована приглушённо, стоит ПОСЛЕ действующих и НЕ
 * предлагает войти — филиал заархивирован, сервер туда не пустит.
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
  // Филиал, в который прямо сейчас идёт мгновенный переход (167). Не просто
  // флаг «занято»: пока он не null, ВСЕ кнопки перехода выключены — второй
  // клик по соседней карточке отправил бы второй перевыпуск сессии, и какой из
  // двух токенов окажется живым, зависело бы от гонки ответов.
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // ТОТ ЖЕ ЗАПРЕТ, НО СИНХРОННЫЙ. Состояние обновляется к следующему рендеру, а
  // между нажатием и запросом теперь есть await (замер офлайн-очереди): два
  // быстрых клика по разным карточкам успели бы проскочить оба, увидев в
  // замыкании ещё пустой switchingId. Два перевыпуска сессии подряд — это гонка
  // за то, какой токен останется живым, то есть выход на экран входа посреди
  // работы. Ref выставляется ДО первого await и потому не проскакивает.
  const switchBusyRef = useRef(false);
  // Отказ сервера при переходе. Держим на экране, а не показываем тостом:
  // тост уезжает через три секунды, а «Мгновенное переключение доступно только
  // руководителю» — это инструкция, которую человек должен успеть прочитать.
  const [switchError, setSwitchError] = useState<string | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

  /**
   * МГНОВЕННЫЙ ПЕРЕХОД (167). Сервер перевыпускает сессию, AuthContext.switchPoint
   * применяет новый токен и стирает все кеши — ровно как после входа. Дальше
   * уводим на главную: она первой покажет цифры нового филиала, и это лучшее
   * доказательство, что переход состоялся.
   *
   * ОФЛАЙН-ОЧЕРЕДЬ РЕШАЕТСЯ ВНУТРИ switchPoint: он доигрывает её под СТАРЫМ
   * токеном и отказывается менять филиал, если что-то осталось. Здесь мы ловим
   * этот отказ отдельно от серверных — у него другая причина и другой ответ
   * человеку («ваши чеки на месте, вы остались там же»), а
   * resolveSwitchPointFailure принял бы его за отсутствие связи.
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
      // прежнего филиала), и вместе с ними пропадает справочник точек — на этот
      // кадр подпись в шапке исчезла бы, а человек как раз в этот момент ищет
      // подтверждение, что попал куда хотел. Справочник филиалов — данные
      // ТЕНАНТА (имена, адреса, состав), они одинаковы во всех филиалах и
      // чужими деньгами быть не могут, поэтому класть их обратно безопасно.
      // Прогрев из commitSession уже в пути и заменит это ответом сервера.
      queryClient.setQueryData<PointsListResponse>(POINTS_QUERY_KEY, { points, currentPointId: point.id });
      setSwitchingId(null);
      toast.success(`Вы перешли в «${point.name}»`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (isOfflineQueueBlockedError(err)) {
        // Сессия НЕ тронута: филиал прежний, токен прежний, очередь на диске
        // цела. Единственное, что нужно человеку, — узнать, что именно не
        // отправилось и что делать дальше.
        setSwitchError(queueBlockMessage(err.verdict, currentPointName));
        setSwitchingId(null);
        return;
      }
      const failure = resolveSwitchPointFailure(err);
      if (failure.action === 'relogin') {
        // Сессия действительно мертва (токен отозван, аккаунт уволен): второй
        // попытки нет. Уводим на вход, показав причину, — иначе человек
        // останется на экранах, где ни одна цифра больше не обновится. Кнопки
        // НАМЕРЕННО оставляем выключенными: до перезагрузки на вход нажимать
        // здесь больше нечего, а повторное нажатие дало бы ту же ошибку.
        endSessionWithNotice(failure.message);
        return;
      }
      if (failure.action === 'refresh') {
        // Отказ по ПРАВИЛУ (403), сессия жива. Перечитываем список филиалов и
        // профиль: чаще всего доступ к филиалу сняли или право управления
        // персоналом забрали прямо сейчас, и интерфейс обязан перестать
        // предлагать действие, которого больше нет.
        void queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ['points-summary'] });
        void refreshUser();
      }
      setSwitchError(failure.message);
      setSwitchingId(null);
    } finally {
      // Снимаем синхронный запрет ВСЕГДА. На ветке `relogin` кнопки остаются
      // выключенными сами — там switchingId намеренно не сбрасывается, и жать
      // до перезагрузки на вход больше нечего.
      switchBusyRef.current = false;
    }
  };

  /**
   * НАЖАТИЕ «ПЕРЕЙТИ В ЭТОТ ФИЛИАЛ» — развилка по офлайн-очереди (167-web).
   *
   *   • очередь пуста (обычный случай, сеть была) → переходим СРАЗУ, без
   *     единого вопроса: лишний диалог на каждом переходе быстро перестают
   *     читать, и тогда он не защитит и в тот единственный раз, когда нужен;
   *   • в очереди что-то есть → спрашиваем. Это деньги, набитые без связи, и
   *     человек обязан узнать о них ДО перехода и увидеть, сколько их.
   *
   * Замер best-effort: отказ диска даёт ноль и НЕ запрещает переход — реальную
   * гарантию всё равно держит switchPoint, который доигрывает очередь и
   * откажется менять филиал, если что-то осталось.
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
   * Замеряем очередь ради честного предупреждения: выход из аккаунта её
   * СТИРАЕТ — за клавиатуру может сесть другой человек, и досылать чужие
   * записи под его токеном нельзя. Молча удалять пробитые чеки — нельзя тем
   * более, поэтому цифра попадает прямо в текст диалога.
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
  // взгляд сверху, и владелец, назначенный на один филиал, обязан видеть цифры
  // второго. Действие «Войти» при этом появляется только там, куда сервер его
  // пустит. Правило сборки и порядок — общие с мобилкой (shared/utils/pointCards).
  const rows = useMemo(() => buildPointCardRows({ points, summary: summaryData?.points ?? [] }), [points, summaryData]);

  // Основной сервис — отдельной секцией сверху. Закрытым он быть не может
  // (API запрещает архивировать основной), но проверку держим явной: закрытая
  // карточка в секции «Основной сервис» выглядела бы как закрытая компания.
  const mainRow = rows.find((r) => r.isMain && !r.isArchived) ?? null;
  const branchRows = rows.filter((r) => r !== mainRow);

  const renderCard = (row: PointCardRow) => (
    <PointCard
      key={row.pointId}
      row={row}
      summaryLoading={summaryLoading}
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
    <div>
      <PageHeader title="Филиалы" icon={Building2} subtitle="Основной сервис и филиалы" />

      <div className="max-w-3xl space-y-6">
        {isLoading && rows.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : rows.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <Building2 className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm font-semibold text-gray-900">Пока нет филиалов</p>
            <p className="mt-1 text-xs text-gray-500">
              Дополнительный автосервис заводит суперадмин в панели управления.
            </p>
          </div>
        ) : (
          <>
            {/* Объяснение модели первым экраном: это не «главная и её
                придаток», а два самостоятельных автосервиса одного владельца.
                Без этой строки владелец не понимает, почему выручка не
                суммируется и где он вообще сейчас работает. Вторая фраза
                разная: руководителю переход стоит одного нажатия, сотруднику —
                выхода и входа, и обещать ему лёгкий переход нельзя. */}
            <p className="text-sm leading-relaxed text-gray-600">
              Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
              зарплата. Вы работаете в том филиале, который выбран в этой сессии;{' '}
              {canSwitchInstantly
                ? 'перейти в другой можно прямо здесь — данные перезагрузятся под новый филиал.'
                : 'чтобы перейти в другой, нужно выйти и войти заново.'}
            </p>

            {switchError && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
                {switchError}
              </p>
            )}

            {mainRow && (
              <section className="space-y-2">
                <SectionLabel text="Основной сервис" />
                {renderCard(mainRow)}
              </section>
            )}

            {branchRows.length > 0 && (
              <section className="space-y-2">
                <SectionLabel text={branchRows.length === 1 ? 'Филиал' : 'Филиалы'} />
                <div className="space-y-3">{branchRows.map(renderCard)}</div>
              </section>
            )}
          </>
        )}
      </div>

      {/*
        «Войти в этот филиал» = ВЫЙТИ и войти заново. Этот путь остаётся у
        сотрудника: мгновенный перевыпуск сессии сервер разрешает только
        держателю права управления персоналом (167).

        Отсюда и честное предупреждение: страница выйдет из аккаунта, всё
        незавершённое (набранный заказ-наряд живёт только в памяти вкладки)
        будет потеряно, и понадобится ввести пароль. Лучше сказать это до, чем
        показать человеку экран входа без объяснений.
      */}
      <ConfirmDialog
        isOpen={!!enterTarget}
        onClose={() => setEnterTarget(null)}
        onConfirm={() => {
          // logout() гасит токен и чистит все кеши, поэтому после входа в
          // другой филиал на экранах не мелькнут цифры этого. Дальше
          // маршрутизация сама уводит на /login.
          logout();
        }}
        title={enterTarget ? `Войти в «${enterTarget.point.name}»?` : ''}
        message={
          'Филиал выбирается при входе, поэтому сейчас произойдёт выход из аккаунта. Введите телефон и пароль ещё раз ' +
          'и выберите этот филиал в списке. Незавершённые заказ-наряды будут потеряны.' +
          // Про офлайн-очередь говорим отдельной фразой и только когда в ней
          // что-то есть: постоянная строка про «неотправленные операции»
          // пугала бы там, где терять нечего.
          pendingQueueLogoutWarning(enterTarget?.pending ?? 0)
        }
        confirmText="Выйти и войти"
        variant="danger"
      />

      {/*
        МГНОВЕННЫЙ ПЕРЕХОД ПРИ НЕПУСТОЙ ОФЛАЙН-ОЧЕРЕДИ (167-web). Этот диалог
        появляется ТОЛЬКО когда на устройстве есть неотправленное: пустая
        очередь переключает филиал сразу.

        Подтверждение означает «сначала отправь, потом переходи»: switchPoint
        доигрывает очередь под токеном ТЕКУЩЕГО филиала и меняет сессию только
        по нулевому остатку. Поэтому кнопка названа действием целиком —
        «Отправить и перейти», а не «Перейти»: обещать один шаг, делая два,
        значит соврать ровно там, где на кону деньги.
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

function SectionLabel({ text }: { text: string }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{text}</h2>;
}

function PointCard({
  row,
  summaryLoading,
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

  return (
    <div
      className={`card space-y-4 p-5 ${
        // Закрытый филиал приглушён и не выделен рамкой: он уходит на второй
        // план, но цифры внутри остаются читаемыми — ради них карточка и есть.
        // Фон остаётся белым: на сером плитки цифр (bg-gray-50) слились бы с
        // карточкой. Та же степень приглушения, что и в мобилке.
        isArchived ? 'opacity-[0.86] shadow-none' : isCurrent ? 'ring-1 ring-primary-500' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
            isArchived
              ? 'bg-gray-100 text-gray-400'
              : isCurrent
                ? 'bg-primary-600 text-white'
                : 'bg-primary-50 text-primary-600'
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-base font-bold ${isArchived ? 'text-gray-500' : 'text-gray-900'}`}>{row.name}</p>
          <p className="truncate text-xs text-gray-500">{row.address ? `${kind} · ${row.address}` : kind}</p>
        </div>
        {/* «Закрыт» важнее «Вы здесь»: человек, оставшийся в сессии закрытого
            филиала, обязан в первую очередь узнать, что филиала больше нет. */}
        {isArchived ? (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">
            <Archive className="h-3.5 w-3.5" />
            Закрыт
          </span>
        ) : (
          isCurrent && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-600">
              <Check className="h-3.5 w-3.5" />
              Вы здесь
            </span>
          )
        )}
      </div>

      {canSeeMoney && (
        <div className="grid grid-cols-2 gap-2">
          {summaryLoading && !summary ? (
            <div className="col-span-2 flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
            </div>
          ) : (
            <>
              <Metric label="Оборот за день" value={summary ? formatMoney(summary.revenueToday) : '—'} />
              <Metric label="Оборот за месяц" value={summary ? formatMoney(summary.revenueMonth) : '—'} />
              {canSeeProfit && (
                <Metric
                  label="Прибыль за месяц"
                  value={summary ? formatMoney(summary.profitMonth) : '—'}
                  tone={
                    summary && summary.profitMonth < 0
                      ? 'text-red-600'
                      : summary && summary.profitMonth > 0
                        ? 'text-green-600'
                        : undefined
                  }
                />
              )}
              {/* mastersOnShift === null — учёт смен у тенанта ВЫКЛЮЧЕН, факта
                  не существует. Рисуем прочерк: «0» прочиталось бы как
                  «сегодня никто не вышел» и отправило бы владельца искать
                  несуществующую проблему. */}
              <Metric
                label="Мастеров на работе"
                value={
                  summary && summary.mastersOnShift !== null && summary.mastersOnShift !== undefined
                    ? String(summary.mastersOnShift)
                    : '—'
                }
              />
            </>
          )}
        </div>
      )}

      {/* Состав филиала — СПРАВОЧНО. Настраивается в карточке сотрудника, и
          подпись обязана об этом сказать: иначе владелец будет искать здесь
          кнопку, которой больше нет. У закрытого филиала состава нет: работать
          в нём уже нельзя, и строка про закреплённых только сбивала бы. */}
      {point && !isArchived && (
        <p className="flex items-start gap-1.5 text-xs text-gray-400">
          <Users className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {memberCount > 0
              ? `Закреплены: ${memberCount} — настраивается в карточке сотрудника`
              : 'Никто не закреплён — доступен всем сотрудникам'}
          </span>
        </p>
      )}

      {isArchived ? (
        // Действия «Войти» здесь НЕ БЫВАЕТ: филиал заархивирован, и сервер в
        // него не пустит. Карточка существует только ради денег периода —
        // чтобы сумма карточек сошлась с итогом сети на главной.
        <p className="flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-center text-xs font-semibold text-gray-500">
          <Archive className="h-4 w-4 flex-shrink-0" />
          {isCurrent ? 'Филиал закрыт. Вы работаете в нём до выхода' : 'Филиал закрыт — войти нельзя'}
        </p>
      ) : isCurrent ? (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-500">
          <Check className="h-4 w-4" />
          Вы работаете здесь
        </div>
      ) : canEnter && canSwitchInstantly ? (
        // МГНОВЕННЫЙ ПЕРЕХОД (167) — руководителю. Одно нажатие: сервер
        // перевыпускает сессию, клиент меняет токен и перезагружает все данные.
        <button
          type="button"
          onClick={onSwitch}
          disabled={switching || switchBlocked}
          aria-busy={switching}
          aria-label={`Перейти в автосервис ${row.name} — данные загрузятся заново`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
          {switching ? 'Переходим…' : 'Перейти в этот филиал'}
        </button>
      ) : canEnter ? (
        // СОТРУДНИК: филиал меняется выходом и входом (163). Мгновенный переход
        // сервер ему не разрешит, поэтому и кнопки такой здесь нет.
        <button
          type="button"
          onClick={onEnter}
          aria-label={`Войти в автосервис ${row.name} — потребуется выйти и войти заново`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700"
        >
          <LogIn className="h-4 w-4" />
          Войти в этот филиал
        </button>
      ) : (
        // Филиал виден в сводке, но войти в него нельзя: сотруднику не выдан
        // доступ. Пишем это прямо — кнопка, отвечающая отказом, была бы хуже.
        <p className="rounded-xl bg-gray-50 px-4 py-2.5 text-center text-xs text-gray-500">
          Вход в этот филиал вам не открыт — доступ настраивает владелец в карточке сотрудника.
        </p>
      )}
    </div>
  );
}

/** Плитка одной цифры в карточке автосервиса. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`truncate text-sm font-bold ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
