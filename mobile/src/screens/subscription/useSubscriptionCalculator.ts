import { useEffect, useState } from 'react';
import { captureDataSession } from '../../contexts/dataSession';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../../api/services';
import type { SubscriptionInfo, SubscriptionQuotePreview } from '../../../../shared/types';
import { subscriptionCount, subscriptionQuoteError } from '../../utils/subscriptionPricingText';
export function useSubscriptionCalculator(sub: SubscriptionInfo | undefined, enabled: boolean) {
  const [metadata, setMetadata] = useState<Record<string, SubscriptionQuotePreview>>({});
  const [minimums, setMinimums] = useState({ employees: 1, points: 1 });
  const [selectedId, setPlan] = useState<string | null>(null);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [manualEmployees, setEmployees] = useState<string | null>(null);
  const [manualPoints, setPoints] = useState<string | null>(null);
  const planId = selectedId ?? sub?.planId ?? undefined;
  const plan = sub?.plans.find((p) => p.id === planId);
  const pricing = plan?.pricing ?? (planId ? metadata[planId]?.pricing : undefined);
  const actualEmployees = Math.max(sub?.usage?.employees ?? sub?.currentUsers ?? 1, minimums.employees);
  const actualPoints = Math.max(sub?.usage?.billablePoints ?? 1, minimums.points);
  const employees = manualEmployees ?? String(Math.max(1, actualEmployees));
  const points = manualPoints ?? String(Math.max(1, actualPoints));
  const employeeCount = subscriptionCount(employees),
    pointCount = subscriptionCount(points);
  const valid = !!employeeCount && !!pointCount && employeeCount >= actualEmployees && pointCount >= actualPoints;
  const session = captureDataSession();
  const quote = useQuery({
    queryKey: [
      'subscription-quote',
      { owner: session.key, generation: session.generation },
      planId,
      period,
      employeeCount,
      pointCount,
    ],
    queryFn: async () =>
      (await subscriptionApi.quote({ planId: planId!, period, employees: employeeCount, points: pointCount })).data,
    enabled: enabled && !!planId && valid,
    retry: false,
    placeholderData: () => undefined,
  });
  useEffect(() => {
    const data = quote.data;
    if (data && !quote.isFetching && !quote.isError) setMetadata((previous) => ({ ...previous, [data.planId]: data }));
  }, [quote.data, quote.isFetching, quote.isError]);
  const failure = subscriptionQuoteError(quote.error);
  useEffect(() => {
    if (failure?.data?.code === 'COUNT_BELOW_USAGE')
      setMinimums({ employees: failure.data.minimumEmployees ?? 1, points: failure.data.minimumPoints ?? 1 });
  }, [failure?.data?.code, failure?.data?.minimumEmployees, failure?.data?.minimumPoints]);
  const message = !valid
    ? `Укажите целые числа не меньше фактического состава: сотрудники ${actualEmployees}, филиалы ${actualPoints}.`
    : failure?.data?.code === 'UNPRICED_POINTS'
      ? 'Для нескольких филиалов выберите MAX. Количество филиалов сохранено.'
      : failure?.data?.code === 'COUNT_BELOW_USAGE'
        ? `Состав вырос: сотрудников не меньше ${failure.data.minimumEmployees}, филиалов не меньше ${failure.data.minimumPoints}. Обновите фактический состав.`
        : failure?.data?.code === 'LEGACY_PLAN'
          ? 'Для этого тарифа расчёт по составу недоступен. Выберите другой тариф для сравнения.'
          : quote.isError
            ? 'Не удалось рассчитать стоимость. Повторите расчёт.'
            : '';
  return {
    planId,
    plan,
    maxPlan: sub?.plans.find(
      (candidate) =>
        candidate.isActive && candidate.pricing?.code === 'max' && candidate.pricing.extraPointMonthlyPrice != null,
    ),
    unsupportedPoints: failure?.data?.code === 'UNPRICED_POINTS',
    pricing,
    name: plan?.name ?? (planId ? metadata[planId]?.pricing.name : undefined) ?? sub?.planName,
    setPlan,
    period,
    setPeriod,
    employees,
    points,
    setEmployees,
    setPoints,
    actualEmployees,
    actualPoints,
    quote,
    message,
    valid,
    ready:
      valid &&
      !!quote.data &&
      quote.data.planId === planId &&
      quote.data.quote.period === period &&
      quote.data.quote.employees === employeeCount &&
      quote.data.quote.points === pointCount &&
      !quote.isFetching &&
      !quote.isError,
  };
}
