import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Home, LayoutGrid, Check, LogIn, Loader2, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';

import { pointsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { usePointAccess, useSwitchPoint, ALL_POINTS_LABEL, pointKindLabel } from '../hooks/usePoints';
import PageHeader from '../components/PageHeader';
import { formatMoney } from '../../../shared/utils/formatters';
import type { PointSummary, PointsSummaryResponse, TenantPoint } from '../types';

/**
 * PointsPage — раздел «Филиалы» в вебе: основной автосервис владельца и
 * открытые им филиалы (мульти-точки 156/160/161).
 *
 * ЭТО ЕДИНСТВЕННОЕ МЕСТО ПЕРЕХОДА между автосервисами. Дословно от владельца:
 * «Должен быть основной сервис, он называется ZR AUTO, а филиал ТопГаз — это
 * дополнительно открытый, и переключиться туда можно ТОЛЬКО через филиал, а не
 * везде. Это два разных автосервиса одного владельца просто». В шапке остался
 * лишь индикатор (components/PointIndicator): он показывает, где человек
 * сейчас, и ведёт сюда.
 *
 * ОСНОВНОЙ СЕРВИС ИДЁТ ПЕРВЫМ и подписан как основной (160,
 * tenant_points.is_main): ему принадлежит вся история, заведённая до появления
 * филиалов. Строкой вровень с только что открытым филиалом владелец не понял
 * бы, где лежит его многолетняя выручка.
 *
 * ДЕНЬГИ карточек — GET /points/summary под правом `financial_reports`;
 * прибыль внутри дополнительно закрыта `profit_view` (без права сервер отдаёт
 * 0, поэтому строку не рисуем вовсе — ноль выглядел бы как настоящий убыток).
 *
 * Автосервисы заводит и архивирует только суперадмин — здесь их не создают.
 */

/** Идентификатор карточки «Все автосервисы»: своего id у этого режима нет. */
const ALL_POINTS_ROW_ID = '__all_points__';

export default function PointsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');

  const { selectable, mainPoint, branches, currentPointId, canSeeAllPoints, isLoading } = usePointAccess();
  const { switchPoint, isSwitching } = useSwitchPoint();
  // Какую карточку сейчас открываем — чтобы спиннер крутился ровно на ней.
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

  const summaryByPoint = useMemo(() => {
    const map = new Map<string, PointSummary>();
    for (const s of summaryData?.points ?? []) map.set(s.pointId, s);
    return map;
  }, [summaryData]);

  /**
   * «Перейти» = полностью зайти в автосервис. Переход сбрасывает весь кеш (см.
   * useSwitchPoint), поэтому на главную мы уходим уже без чужих цифр в памяти.
   */
  const enterPoint = async (pointId: string | null) => {
    if (pointId === currentPointId || isSwitching) return;
    setEnteringId(pointId ?? ALL_POINTS_ROW_ID);
    try {
      await switchPoint(pointId);
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось перейти. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setEnteringId(null);
    }
  };

  const renderCard = (p: TenantPoint) => (
    <PointCard
      key={p.id}
      point={p}
      summary={summaryByPoint.get(p.id)}
      summaryLoading={summaryLoading}
      canSeeMoney={canSeeMoney}
      canSeeProfit={canSeeProfit}
      isCurrent={p.id === currentPointId}
      busy={enteringId === p.id}
      isSwitching={isSwitching}
      onEnter={() => void enterPoint(p.id)}
    />
  );

  return (
    <div>
      <PageHeader title="Филиалы" icon={Building2} subtitle="Основной сервис и филиалы" />

      <div className="max-w-3xl space-y-6">
        {isLoading && selectable.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : selectable.length === 0 ? (
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
                суммируется. */}
            <p className="text-sm leading-relaxed text-gray-600">
              Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
              зарплата. Перейти в другой можно только отсюда.
            </p>

            {mainPoint && (
              <section className="space-y-2">
                <SectionLabel text="Основной сервис" />
                {renderCard(mainPoint)}
              </section>
            )}

            {branches.length > 0 && (
              <section className="space-y-2">
                <SectionLabel text={branches.length === 1 ? 'Филиал' : 'Филиалы'} />
                <div className="space-y-3">{branches.map(renderCard)}</div>
              </section>
            )}

            {canSeeAllPoints && (
              <section className="space-y-2">
                <SectionLabel text="Общая сводка" />
                <AllPointsCard
                  isCurrent={currentPointId === null}
                  busy={enteringId === ALL_POINTS_ROW_ID}
                  isSwitching={isSwitching}
                  onEnter={() => void enterPoint(null)}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{text}</h2>;
}

function PointCard({
  point,
  summary,
  summaryLoading,
  canSeeMoney,
  canSeeProfit,
  isCurrent,
  busy,
  isSwitching,
  onEnter,
}: {
  point: TenantPoint;
  summary?: PointSummary;
  summaryLoading: boolean;
  canSeeMoney: boolean;
  canSeeProfit: boolean;
  isCurrent: boolean;
  busy: boolean;
  isSwitching: boolean;
  onEnter: () => void;
}) {
  const kind = pointKindLabel(point);
  // Дом = сам автосервис владельца, здание = открытый позже филиал.
  const Icon = point.isMain ? Home : Building2;

  return (
    <div className={`card space-y-4 p-5 ${isCurrent ? 'ring-1 ring-primary-500' : ''}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
            isCurrent ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-gray-900">{point.name}</p>
          <p className="truncate text-xs text-gray-500">{point.address ? `${kind} · ${point.address}` : kind}</p>
        </div>
        {isCurrent && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-600">
            <Check className="h-3.5 w-3.5" />
            Вы здесь
          </span>
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
                  «сегодня никто не вышел». */}
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

      <EnterButton
        isCurrent={isCurrent}
        busy={busy}
        isSwitching={isSwitching}
        onEnter={onEnter}
        idleIcon={<LogIn className="h-4 w-4" />}
        idleText="Перейти"
        ariaLabel={isCurrent ? `${point.name} — вы здесь` : `Перейти в автосервис ${point.name}`}
      />
    </div>
  );
}

/**
 * «Все автосервисы» — режим общей сводки (currentPointId = null). Отдельной
 * карточкой в конце и только владельцу/админу: это НЕ автосервис, а взгляд
 * сверху, и денежную запись сервер в нём не примет. Выйти из него можно тоже
 * только здесь — иначе владелец, однажды сюда попавший, не мог бы вернуться.
 */
function AllPointsCard({
  isCurrent,
  busy,
  isSwitching,
  onEnter,
}: {
  isCurrent: boolean;
  busy: boolean;
  isSwitching: boolean;
  onEnter: () => void;
}) {
  return (
    <div className={`card space-y-4 p-5 ${isCurrent ? 'ring-1 ring-primary-500' : ''}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
            isCurrent ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'
          }`}
        >
          <LayoutGrid className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-gray-900">{ALL_POINTS_LABEL}</p>
          <p className="truncate text-xs text-gray-500">Цифры сразу по всем — только для просмотра</p>
        </div>
        {isCurrent && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-600">
            <Check className="h-3.5 w-3.5" />
            Вы здесь
          </span>
        )}
      </div>

      {/* Честная подпись: сервер денежную запись без автосервиса не принимает —
          он либо подставит единственный доступный, либо ответит «Выберите
          филиал, …». */}
      <p className="text-xs leading-relaxed text-gray-500">
        Чтобы пробить чек, завести расход или открыть смену, нужно зайти в конкретный автосервис.
      </p>

      <EnterButton
        isCurrent={isCurrent}
        busy={busy}
        isSwitching={isSwitching}
        onEnter={onEnter}
        idleIcon={<BarChart3 className="h-4 w-4" />}
        idleText="Открыть сводку"
        ariaLabel={isCurrent ? 'Открыта общая сводка' : 'Открыть общую сводку по всем автосервисам'}
      />
    </div>
  );
}

/** Кнопка перехода — одна на карточку автосервиса и на карточку сводки. */
function EnterButton({
  isCurrent,
  busy,
  isSwitching,
  onEnter,
  idleIcon,
  idleText,
  ariaLabel,
}: {
  isCurrent: boolean;
  busy: boolean;
  isSwitching: boolean;
  onEnter: () => void;
  idleIcon: React.ReactNode;
  idleText: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onEnter}
      disabled={isCurrent || isSwitching}
      aria-label={ariaLabel}
      className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
        isCurrent
          ? 'cursor-default bg-gray-100 text-gray-500'
          : 'bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50'
      }`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isCurrent ? (
        <>
          <Check className="h-4 w-4" />
          Вы здесь
        </>
      ) : (
        <>
          {idleIcon}
          {idleText}
        </>
      )}
    </button>
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
