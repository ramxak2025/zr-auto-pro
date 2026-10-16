import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createSubscriptionApi } from '../../../shared/api/createServices';
import { createSessionBoundClient } from '../api/axios';
import { parseSubscriptionCount } from '../utils/subscriptionPricingText';
import SubscriptionCompositionFields from '../components/SubscriptionCompositionFields';
import SubscriptionQuoteBreakdown from '../components/SubscriptionQuoteBreakdown';
import { planCompositionLabel } from '../utils/subscriptionPricingText';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, ChevronDown, CreditCard, Info, MessageCircle, Users, X } from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import type { SubscriptionPlanPricing } from '../../../shared/utils/subscriptionPricing';
import { formatSubscriptionMoney } from '../utils/subscriptionPricingText';
import type { SubscriptionInfo } from '../types';
import { Badge, Card, CardBody, CardHeader, Money, PageHeader, QueryState, SkeletonCard, buttonClasses } from '../ui';
import { MiniStat } from '../components/dashboard/shared';
// Возможности тарифа сгруппированы (core / section / integration), чтобы каждая
// карточка тарифа перечисляла 23 ключа под заголовками разделов.
import { FEATURE_GROUPS } from '../utils/featureGroups';
import { getWhatsAppChatUrl } from '../config/contacts';

export default function TariffPage() {
  const { token } = useAuth();
  const subscriptionApi = useMemo(() => createSubscriptionApi(createSessionBoundClient(token)), [token]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [employeeInput, setEmployeeInput] = useState<string>();
  const [pointInput, setPointInput] = useState<string>();
  const [serverPricing, setServerPricing] = useState<{ planId: string; pricing: SubscriptionPlanPricing }>();
  const [quotePeriod, setQuotePeriod] = useState<'monthly' | 'yearly'>('monthly');
  // В слоте ['subscription'] лежит САМ объект подписки — так его пишут оболочка,
  // FeatureGate и App. Раньше страница клала сюда ответ axios и читала `.data`
  // через select: если слот уже был прогрет оболочкой, страница показывала
  // «Тариф не назначен» при живой подписке.
  const {
    data: sub,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
  });

  const currentPlan = sub?.plans?.find((plan) => plan.id === sub.planId);
  const selectedPlan = sub?.plans?.find((plan) => plan.id === (selectedPlanId ?? sub.planId));
  const minimumEmployees = Math.max(1, sub?.usage?.employees ?? sub?.currentUsers ?? 1);
  const minimumPoints = Math.max(1, sub?.usage?.billablePoints ?? 1);
  const employees = employeeInput ?? String(minimumEmployees);
  const points = pointInput ?? String(minimumPoints);
  const employeeCount = parseSubscriptionCount(employees),
    pointCount = parseSubscriptionCount(points);
  const countsValid =
    employeeCount !== undefined &&
    employeeCount >= minimumEmployees &&
    pointCount !== undefined &&
    pointCount >= minimumPoints;
  const quoteQuery = useQuery({
    queryKey: ['subscription-quote', token, selectedPlanId ?? sub?.planId, quotePeriod, employees, points],
    queryFn: async () =>
      (
        await subscriptionApi.quote({
          period: quotePeriod,
          planId: selectedPlanId ?? sub?.planId ?? undefined,
          employees: employeeCount,
          points: pointCount,
        })
      ).data,
    enabled: !!sub?.planId && countsValid,
    retry: false,
    placeholderData: () => undefined,
  });
  useEffect(() => {
    if (quoteQuery.data && quoteQuery.data.planId === sub?.planId)
      setServerPricing({ planId: quoteQuery.data.planId, pricing: quoteQuery.data.pricing });
  }, [quoteQuery.data, sub?.planId]);
  const currentPricing =
    currentPlan?.pricing ?? (serverPricing && serverPricing.planId === sub?.planId ? serverPricing.pricing : undefined);
  const subscriptionEnd = sub?.subscriptionEnd ? parseISO(sub.subscriptionEnd) : null;
  const isExpired = subscriptionEnd ? isPast(subscriptionEnd) : false;

  const selectedQuote = countsValid && !quoteQuery.isError && !quoteQuery.isFetching ? quoteQuery.data : undefined;
  const whatsappUrl = getWhatsAppChatUrl(
    selectedQuote
      ? `Здравствуйте! Хочу обсудить подписку ${selectedQuote.pricing.name}. Сотрудников: ${selectedQuote.quote.employees}, филиалов: ${selectedQuote.quote.points}, срок: ${quotePeriod === 'yearly' ? '12 месяцев' : 'месяц'}. Расчёт: ${formatSubscriptionMoney(selectedQuote.quote.total)}${quotePeriod === 'yearly' ? ' сразу за 12 месяцев' : ''}.`
      : 'Здравствуйте! Хочу оплатить подписку.',
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Тариф и подписка"
        icon={CreditCard}
        subtitle="Ваш тариф, срок оплаты и доступные возможности"
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        loader={
          <div className="max-w-3xl space-y-5">
            <SkeletonCard lines={3} />
          </div>
        }
        minHeight="min-h-[40vh]"
        errorTitle="Не удалось загрузить подписку"
      >
        <div className="space-y-6">
          {/* Текущая подписка */}
          <Card padding="none" className="max-w-3xl">
            <CardHeader
              icon={CreditCard}
              title={sub?.tenantName || 'Ваша организация'}
              subtitle={sub?.planName ? `Тариф: ${sub.planName}` : 'Тариф не назначен'}
              actions={
                sub?.status && sub.status !== 'active' ? (
                  <Badge tone={sub.status === 'suspended' ? 'bad' : 'warn'} dot>
                    {sub.status === 'suspended' ? 'Приостановлена' : 'Истекла'}
                  </Badge>
                ) : isExpired ? (
                  <Badge tone="bad" dot>
                    Истекла
                  </Badge>
                ) : subscriptionEnd ? (
                  <Badge tone="ok" dot>
                    Активна
                  </Badge>
                ) : undefined
              }
            />
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
                <MiniStat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      Оплачено до
                    </span>
                  }
                  value={subscriptionEnd ? format(subscriptionEnd, 'd MMMM yyyy', { locale: ru }) : 'Не указано'}
                  tone={isExpired ? 'bad' : 'neutral'}
                />
                <MiniStat
                  label="Базовая стоимость"
                  value={sub?.monthlyPrice ? <Money value={sub.monthlyPrice} /> : 'Не указано'}
                  hint={sub?.monthlyPrice ? 'в месяц' : undefined}
                />
                {sub && (
                  <MiniStat
                    label={
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        Сотрудников
                      </span>
                    }
                    value={
                      currentPricing
                        ? `${sub.usage?.employees ?? sub.currentUsers} · включено ${currentPricing.includedEmployees}`
                        : `${sub.currentUsers} / ${sub.maxUsers}`
                    }
                    tone={!currentPricing && sub.currentUsers >= sub.maxUsers ? 'warn' : 'neutral'}
                  />
                )}
              </div>

              {sub?.planId && (
                <div className="space-y-3">
                  <h2 className="text-md font-semibold text-ink">Рассчитать стоимость команды</h2>
                  <p className="text-sm text-ink-2">
                    Сейчас сотрудников: {minimumEmployees}, включая владельца; филиалов:{' '}
                    {sub.usage?.activePoints ?? minimumPoints}. Расчёт информационный: выбор не меняет ваш тариф и
                    оплаченный срок.
                  </p>
                  <SubscriptionCompositionFields
                    employeePresets
                    employees={employees}
                    points={points}
                    minimumEmployees={minimumEmployees}
                    minimumPoints={minimumPoints}
                    onEmployeesChange={setEmployeeInput}
                    onPointsChange={setPointInput}
                  />
                  <label className="block text-sm text-ink-2">
                    Тариф для расчёта
                    <select
                      aria-label="Тариф для расчёта"
                      className="mt-1 block min-h-[44px] w-full rounded-lg border border-line bg-surface px-3 text-ink"
                      value={selectedPlanId ?? sub.planId}
                      onChange={(event) => setSelectedPlanId(event.target.value)}
                    >
                      {!currentPlan && <option value={sub.planId}>Текущий тариф: {sub.planName}</option>}
                      {sub.plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.id === sub.planId ? ' · текущий' : ''}
                          {!plan.isActive ? ' · архивный' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedPlan?.description && <p className="text-sm text-ink-3">{selectedPlan.description}</p>}
                  <div role="group" aria-label="Период расчёта" className="flex flex-wrap gap-2">
                    {(['monthly', 'yearly'] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        aria-pressed={period === quotePeriod}
                        className={buttonClasses({ variant: quotePeriod === period ? 'primary' : 'secondary' })}
                        onClick={() => setQuotePeriod(period)}
                      >
                        {period === 'monthly' ? 'Месяц' : 'Год · 12 за 10'}
                      </button>
                    ))}
                  </div>
                  {!countsValid ? (
                    <p role="status" className="text-sm text-bad">
                      Проверьте количество сотрудников и филиалов. Оно не может быть меньше фактического.
                    </p>
                  ) : quoteQuery.isFetching ? (
                    <p role="status" className="text-sm text-ink-3">
                      Загружаем расчёт…
                    </p>
                  ) : quoteQuery.data && !quoteQuery.isError ? (
                    <SubscriptionQuoteBreakdown preview={quoteQuery.data} compact />
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-ink-2">
                        Расчёт выбранного состава недоступен. Для нескольких филиалов выберите MAX. Условия прежних
                        тарифов уточняются отдельно; годовая скидка к ним автоматически не применяется.
                      </p>
                      <button
                        type="button"
                        className={buttonClasses({ variant: 'secondary' })}
                        onClick={() => {
                          void quoteQuery.refetch();
                        }}
                      >
                        Повторить расчёт
                      </button>
                    </div>
                  )}
                </div>
              )}
              {sub?.subscriptionNote && (
                <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info-soft px-4 py-3">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-info" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-info-text">Примечание</p>
                    <p className="mt-0.5 text-sm text-info-text">{sub.subscriptionNote}</p>
                  </div>
                </div>
              )}

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: 'primary', className: 'w-full sm:w-auto' })}
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Связаться для оплаты (WhatsApp)
              </a>
            </CardBody>
          </Card>

          {sub?.plans && sub.plans.length > 0 && (
            <details className="max-w-5xl border-t border-line">
              <summary className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
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
                      {sub.plans.map((plan) => (
                        <th key={plan.id} scope="col" className="min-w-[180px] p-3 align-top">
                          <span className="block font-semibold text-ink">
                            {plan.name}
                            {plan.id === sub.planId ? ' · ваш тариф' : ''}
                          </span>
                          {!plan.isActive && <span className="text-xs font-normal text-ink-3">Архивный тариф</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-line">
                      <th scope="row" className="p-3 align-top font-medium">
                        Состав и условия
                      </th>
                      {sub.plans.map((plan) => (
                        <td key={plan.id} className="p-3 align-top text-ink-2">
                          {planCompositionLabel(plan)}
                        </td>
                      ))}
                    </tr>
                    {FEATURE_GROUPS.flatMap((group) => group.items).map((feature) => (
                      <tr key={feature.key} className="border-b border-line">
                        <th scope="row" className="p-3 font-medium text-ink-2">
                          {feature.label}
                        </th>
                        {sub.plans.map((plan) => (
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
