import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Building2, Home, Check, LogIn, Loader2, Users } from 'lucide-react';

import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { usePointAccess, pointKindLabel } from '../hooks/usePoints';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatMoney } from '../../../shared/utils/formatters';
import { buildPointCardRows, type PointCardRow } from '../../../shared/utils/pointCards';
import type { PointsSummaryResponse, TenantPoint } from '../types';

/**
 * PointsPage — раздел «Филиалы» в вебе: основной автосервис владельца и
 * открытые им филиалы (мульти-точки 156/160/161/163).
 *
 * ФИЛИАЛ ЗДЕСЬ НЕ ПЕРЕКЛЮЧАЕТСЯ (163). Требование владельца дословно: «чтобы
 * выйти и войти в другой им надо опять выйти и войти в другой филиал». Филиал
 * — свойство СЕССИИ: он выбирается при входе и живёт ровно столько, сколько
 * живёт токен. Поэтому в карточке чужого филиала стоит действие «Войти в этот
 * филиал», которое честно предупреждает, что текущая сессия завершится, и по
 * подтверждению делает ВЫХОД — дальше человек входит заново и выбирает филиал
 * на экране входа. Тихого перехода нет: именно из-за него веб молча уезжал в
 * филиал, выбранный на телефоне.
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
 *   • «Войти в этот филиал» — только для филиалов, куда человека пускает
 *     сервер (usePointAccess.selectable — зеркало autexa_available_points);
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
  const { hasPermission, logout } = useAuth();
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');

  const { points, selectable, currentPointId, isLoading } = usePointAccess();

  const canEnter = (pointId: string) => selectable.some((p) => p.id === pointId);

  // Филиал, в который человек попросился войти: держим до подтверждения —
  // выход из аккаунта нельзя делать по одному клику.
  const [enterTarget, setEnterTarget] = useState<TenantPoint | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

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
      // Войти можно только в ЖИВОЙ филиал, куда пускает сервер. У закрытого
      // живой записи нет вовсе — и входить в него некуда.
      canEnter={!row.isArchived && row.point !== null && canEnter(row.pointId)}
      onEnter={() => {
        if (row.point) setEnterTarget(row.point);
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
                суммируется и где он вообще сейчас работает. */}
            <p className="text-sm leading-relaxed text-gray-600">
              Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
              зарплата. Вы работаете в том филиале, в который вошли; чтобы перейти в другой, нужно выйти и войти заново.
            </p>

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
        «Войти в этот филиал» = ВЫЙТИ и войти заново.

        Почему именно так, а не «переключить»: филиал лежит в подписанном
        токене (163), и отобрать его у выданной сессии нельзя — можно только
        выдать новую. Отсюда и честное предупреждение: страница выйдет из
        аккаунта, всё незавершённое (набранный заказ-наряд живёт только в
        памяти вкладки) будет потеряно, и понадобится ввести пароль. Лучше
        сказать это до, чем показать человеку экран входа без объяснений.
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
        title={enterTarget ? `Войти в «${enterTarget.name}»?` : ''}
        message={
          'Филиал выбирается при входе, поэтому сейчас произойдёт выход из аккаунта. Введите телефон и пароль ещё раз ' +
          'и выберите этот филиал в списке. Незавершённые заказ-наряды будут потеряны.'
        }
        confirmText="Выйти и войти"
        variant="danger"
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
  onEnter,
}: {
  row: PointCardRow;
  summaryLoading: boolean;
  canSeeMoney: boolean;
  canSeeProfit: boolean;
  isCurrent: boolean;
  /** Пустит ли сервер этого человека в этот филиал (user_points, 163). */
  canEnter: boolean;
  onEnter: () => void;
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
      ) : canEnter ? (
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
