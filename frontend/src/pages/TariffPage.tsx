import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createSubscriptionApi } from '../../../shared/api/createServices';
import { createSessionBoundClient } from '../api/axios';
import {
  assignedSubscriptionPlan,
  initialSubscriptionOffer,
  matchesSubscriptionQuote,
  subscriptionOffers,
} from '../../../shared/utils/subscriptionPresentation';
import {
  parseSubscriptionCount,
  planCompositionLabel,
  formatSubscriptionMoney as money,
} from '../utils/subscriptionPricingText';
import SubscriptionCompositionFields from '../components/SubscriptionCompositionFields';
import SubscriptionQuoteBreakdown from '../components/SubscriptionQuoteBreakdown';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, MessageCircle, ShieldCheck, X } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { SubscriptionInfo } from '../types';
import { Badge, Card, PageHeader, QueryState, SkeletonCard, buttonClasses } from '../ui';
import { FEATURE_GROUPS } from '../utils/featureGroups';
import { getWhatsAppChatUrl } from '../config/contacts';

export default function TariffPage() {
  const { token, hasPermission } = useAuth();
  const allowed = hasPermission('company_manage');
  const subscriptionApi = useMemo(() => createSubscriptionApi(createSessionBoundClient(token)), [token]);
  const initial = {
    token,
    planId: undefined as string | undefined,
    employees: undefined as string | undefined,
    points: undefined as string | undefined,
    period: 'monthly' as 'monthly' | 'yearly',
  };
  const [stored, setStored] = useState(initial);
  const controls = stored.token === token ? stored : initial;
  const update = (patch: Partial<typeof initial>) =>
    setStored((old) => ({ ...(old.token === token ? old : initial), ...patch }));
  const {
    data: sub,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    enabled: allowed,
  });
  const currentPlan = assignedSubscriptionPlan(sub);
  const archived = currentPlan?.isActive === false;
  const offers = subscriptionOffers(sub);
  const planId = controls.planId ?? initialSubscriptionOffer(sub);
  const selectedPlan = offers.find((plan) => plan.id === planId);
  const minimumEmployees = Math.max(1, sub?.usage?.employees ?? sub?.currentUsers ?? 1);
  const minimumPoints = Math.max(1, sub?.usage?.billablePoints ?? 1);
  const employees =
    controls.employees ?? String(Math.max(minimumEmployees, selectedPlan?.pricing?.includedEmployees ?? 1));
  const points = controls.points ?? String(minimumPoints);
  const employeeCount = parseSubscriptionCount(employees),
    pointCount = parseSubscriptionCount(points);
  const countsValid =
    employeeCount !== undefined &&
    employeeCount >= minimumEmployees &&
    pointCount !== undefined &&
    pointCount >= minimumPoints;
  const quotePeriod = controls.period;
  const quoteQuery = useQuery({
    queryKey: ['subscription-quote', token, selectedPlan?.id, quotePeriod, employeeCount, pointCount],
    queryFn: async () =>
      (
        await subscriptionApi.quote({
          period: quotePeriod,
          planId: selectedPlan?.id,
          employees: employeeCount,
          points: pointCount,
        })
      ).data,
    enabled: allowed && !!selectedPlan && countsValid,
    retry: false,
    placeholderData: () => undefined,
  });
  const selectedQuote =
    countsValid &&
    !quoteQuery.isError &&
    !quoteQuery.isFetching &&
    matchesSubscriptionQuote(quoteQuery.data, selectedPlan?.id, quotePeriod, employeeCount, pointCount)
      ? quoteQuery.data
      : undefined;
  const failure = (
    quoteQuery.error as {
      response?: { data?: { code?: string; minimumEmployees?: number; minimumPoints?: number } };
    } | null
  )?.response?.data;
  const maxPlan = offers.find(
    (plan) =>
      plan.id !== selectedPlan?.id && plan.pricing?.code === 'max' && plan.pricing.extraPointMonthlyPrice != null,
  );
  const end = sub?.subscriptionEnd ? parseISO(sub.subscriptionEnd) : undefined;
  const endLabel =
    sub?.subscriptionEnd === null
      ? 'Без ограничения срока'
      : end && isValid(end)
        ? format(end, 'd MMMM yyyy', { locale: ru })
        : 'Срок не указан';
  const status = sub?.status === 'suspended' ? 'Приостановлена' : sub?.status === 'expired' ? 'Истекла' : 'Активна';
  const whatsappUrl = selectedQuote
    ? getWhatsAppChatUrl(
        `Здравствуйте! Хочу обсудить подписку ${selectedQuote.pricing.name}. Сотрудников: ${selectedQuote.quote.employees}, филиалов: ${selectedQuote.quote.points}, срок: ${quotePeriod === 'yearly' ? '12 месяцев' : 'месяц'}. Расчёт: ${money(selectedQuote.quote.total)}${quotePeriod === 'yearly' ? ' сразу за 12 месяцев' : ''}.`,
      )
    : undefined;
  const features = FEATURE_GROUPS.flatMap((group) => group.items);
  if (!allowed) return <PageHeader variant="static" title="Подписка" subtitle="Нет доступа к настройкам компании." />;
  return (
    <div className="mx-auto max-w-6xl space-y-7 pb-4">
      <PageHeader variant="static" title="Тариф и подписка" />
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        loader={
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={5} />
          </>
        }
        minHeight="min-h-[40vh]"
        errorTitle="Не удалось загрузить подписку"
      >
        <div className="space-y-8">
          <Card className="overflow-hidden shadow-none" aria-label="Текущая подписка">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <h2 className="flex items-center gap-2 text-md font-semibold text-ink">
                <ShieldCheck className="h-5 w-5 text-ink-2" aria-hidden />
                Текущая подписка
              </h2>
              <Badge tone={sub?.status === 'suspended' ? 'bad' : sub?.status === 'expired' ? 'warn' : 'ok'} dot>
                {status}
              </Badge>
            </div>
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1.3fr] lg:gap-10">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-semibold text-ink">{sub?.planName ?? 'Тариф не назначен'}</h3>
                  {archived && <Badge tone="neutral">Архивный тариф</Badge>}
                </div>
                <p className="mt-2 text-sm text-ink-2">{sub?.tenantName ?? 'Ваша организация'}</p>
                {archived && (
                  <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-2">
                    У вас сохранены условия прежнего тарифа. Ниже можно рассчитать новый.
                  </p>
                )}
              </div>
              <dl className="divide-y divide-line text-sm">
                {[
                  ['Доступ до', endLabel],
                  ['Месячная ставка', sub?.monthlyPrice != null ? money(sub.monthlyPrice) : 'Ставка не указана'],
                  [
                    'Сотрудники',
                    `${sub?.usage?.employees ?? sub?.currentUsers ?? 0} · лимит ${sub?.maxUsers ?? 'не указан'}`,
                  ],
                  ['Действующие филиалы', String(sub?.usage?.activePoints ?? 'Не указано')],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <dt className="text-ink-2">{label}</dt>
                    <dd className="ml-auto text-right font-medium tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <details className="border-t border-line px-5 sm:px-6">
              <summary className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                Возможности текущего тарифа
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </summary>
              <ul className="grid gap-3 pb-5 text-sm text-ink-2 sm:grid-cols-2">
                {sub?.features?.length ? (
                  sub.features.map((key) => (
                    <li key={key} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                      {features.find((feature) => feature.key === key)?.label ?? key}
                    </li>
                  ))
                ) : (
                  <li>Список возможностей не указан.</li>
                )}
              </ul>
            </details>
            {sub?.subscriptionNote && (
              <p className="border-t border-line px-5 py-4 text-sm leading-relaxed text-ink-2 sm:px-6">
                {sub.subscriptionNote}
              </p>
            )}
          </Card>
          <section aria-labelledby="subscription-builder-title" className="space-y-4">
            <div>
              <h2 id="subscription-builder-title" className="text-xl font-semibold text-ink">
                Соберите новый тариф
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Подберите состав и период. Расчёт не меняет вашу подписку.
              </p>
            </div>
            {offers.length ? (
              <Card className="overflow-hidden shadow-none">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6 p-5 sm:p-6">
                    <fieldset>
                      <legend className="mb-3 text-sm font-semibold text-ink">Тариф для расчёта</legend>
                      <div className="grid grid-cols-3 gap-2">
                        {offers.map((plan) => (
                          <label
                            key={plan.id}
                            className={`relative flex min-h-[108px] cursor-pointer flex-col justify-between gap-2 rounded-xl border p-3 ${selectedPlan?.id === plan.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}
                          >
                            <input
                              type="radio"
                              name="subscription-plan"
                              aria-label={`Тариф ${plan.name}`}
                              value={plan.id}
                              checked={selectedPlan?.id === plan.id}
                              onChange={() => update({ planId: plan.id })}
                              className="peer sr-only"
                            />
                            <span className="absolute inset-0 rounded-xl peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
                            <span className="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
                              {plan.name}
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-full border ${selectedPlan?.id === plan.id ? 'border-accent bg-accent text-white' : 'border-line-strong'}`}
                              >
                                {selectedPlan?.id === plan.id && <Check className="h-3 w-3" aria-hidden />}
                              </span>
                            </span>
                            <span className="text-xs leading-relaxed text-ink-2">
                              Включено: {plan.pricing?.includedEmployees} сотр.
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {selectedPlan?.pricing && (
                      <p className="text-sm text-ink-2">
                        Включено {selectedPlan.pricing.includedEmployees} сотрудников · дополнительных{' '}
                        {employeeCount == null
                          ? '—'
                          : Math.max(0, employeeCount - selectedPlan.pricing.includedEmployees)}
                        .{' '}
                        {selectedPlan.pricing.includedPoints == null
                          ? 'Один филиал.'
                          : `Включено филиалов: ${selectedPlan.pricing.includedPoints}.`}
                      </p>
                    )}
                    <div className="space-y-3 border-t border-line pt-5">
                      <h3 className="text-sm font-semibold text-ink">Состав команды</h3>
                      <SubscriptionCompositionFields
                        largeInputs
                        employees={employees}
                        points={points}
                        minimumEmployees={minimumEmployees}
                        minimumPoints={minimumPoints}
                        onEmployeesChange={(value) => update({ employees: value })}
                        onPointsChange={(value) => update({ points: value })}
                        employeePresets
                      />
                      <p className="text-xs text-ink-2">
                        Сейчас работает: {minimumEmployees} сотрудников, включая владельца · филиалов{' '}
                        {sub?.usage?.activePoints ?? minimumPoints}.
                      </p>
                    </div>
                    <fieldset className="border-t border-line pt-5">
                      <legend className="text-sm font-semibold text-ink">Период расчёта</legend>
                      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
                        {(['monthly', 'yearly'] as const).map((period) => (
                          <button
                            key={period}
                            type="button"
                            aria-pressed={quotePeriod === period}
                            onClick={() => update({ period })}
                            className={`min-h-[48px] rounded-lg px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${quotePeriod === period ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
                          >
                            {period === 'monthly' ? 'Месяц' : 'Год · 12 за 10'}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    {selectedPlan && (
                      <details className="border-t border-line">
                        <summary className="flex min-h-[48px] cursor-pointer items-center justify-between gap-2 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                          Условия выбранного тарифа
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        </summary>
                        <p className="text-sm leading-relaxed text-ink-2">{planCompositionLabel(selectedPlan)}</p>
                        {selectedPlan.description && (
                          <p className="mt-2 text-sm text-ink-2">{selectedPlan.description}</p>
                        )}
                      </details>
                    )}
                  </div>
                  <div
                    className="flex flex-col gap-4 border-t border-line bg-surface-2 p-5 sm:p-6 lg:border-l lg:border-t-0"
                    aria-label="Итог расчёта"
                    aria-live="polite"
                    aria-busy={quoteQuery.isFetching}
                  >
                    <h3 className="text-md font-semibold text-ink">
                      Ваш расчёт{selectedPlan ? ` · ${selectedPlan.name}` : ''}
                    </h3>
                    {selectedQuote ? (
                      <SubscriptionQuoteBreakdown preview={selectedQuote} compact />
                    ) : (
                      <div className="min-h-[160px] text-sm leading-relaxed text-ink-2">
                        {!selectedPlan
                          ? 'Выберите тариф, чтобы увидеть стоимость нового состава.'
                          : !countsValid
                            ? 'Проверьте количество сотрудников и филиалов. Оно не может быть меньше фактического.'
                            : quoteQuery.isFetching
                              ? 'Считаем стоимость…'
                              : failure?.code === 'UNPRICED_POINTS'
                                ? 'Для нескольких филиалов выберите MAX. Ваш состав сохранён.'
                                : failure?.code === 'COUNT_BELOW_USAGE'
                                  ? `Состав вырос: сотрудников не меньше ${failure.minimumEmployees}, филиалов не меньше ${failure.minimumPoints}. Обновите состав.`
                                  : 'Не удалось рассчитать стоимость. Повторите расчёт.'}
                      </div>
                    )}
                    {selectedPlan && quoteQuery.isError && countsValid && (
                      <button
                        type="button"
                        className={buttonClasses({ variant: 'secondary', size: 'lg' })}
                        onClick={() => {
                          if (failure?.code === 'UNPRICED_POINTS' && maxPlan) update({ planId: maxPlan.id });
                          else void quoteQuery.refetch();
                        }}
                      >
                        {failure?.code === 'UNPRICED_POINTS' && maxPlan ? 'Рассчитать MAX' : 'Повторить расчёт'}
                      </button>
                    )}
                    <div className="mt-2 border-t border-line pt-5 lg:mt-auto">
                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full text-sm' })}
                        >
                          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                          Обсудить этот расчёт
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full text-sm' })}
                        >
                          Обсудить этот расчёт
                        </button>
                      )}
                      <p className="mt-3 text-xs leading-relaxed text-ink-2">
                        Обсуждение в WhatsApp. Условия и срок текущей подписки сохраняются до согласования изменений.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card padding="md" className="shadow-none">
                <p className="font-medium text-ink">Нет доступных тарифов для расчёта</p>
                <p className="mt-1 text-sm text-ink-2">
                  Текущие условия показаны выше. Обновите данные, чтобы проверить доступность конструктора.
                </p>
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'mt-4' })}
                  onClick={() => void refetch()}
                >
                  Обновить данные
                </button>
              </Card>
            )}
          </section>
          {offers.length > 0 && (
            <details className="border-t border-line">
              <summary className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 text-sm font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                Сравнить все возможности тарифов
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </summary>
              <div className="overflow-x-auto pb-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="p-3">
                        Возможность
                      </th>
                      {offers.map((plan) => (
                        <th key={plan.id} scope="col" className="min-w-[160px] p-3 font-semibold text-ink">
                          {plan.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {features.map((feature) => (
                      <tr key={feature.key} className="border-b border-line">
                        <th scope="row" className="p-3 font-medium text-ink-2">
                          {feature.label}
                        </th>
                        {offers.map((plan) => (
                          <td key={plan.id} className="p-3">
                            {plan.features?.includes(feature.key) ? (
                              <>
                                <Check className="h-4 w-4 text-ok" aria-hidden />
                                <span className="sr-only">Входит</span>
                              </>
                            ) : (
                              <>
                                <X className="h-4 w-4 text-ink-3" aria-hidden />
                                <span className="sr-only">Не входит</span>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      </QueryState>
    </div>
  );
}
