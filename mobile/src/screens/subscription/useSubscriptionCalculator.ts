import { useEffect, useState } from 'react';
import { captureDataSession } from '../../contexts/dataSession';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../../api/services';
import type { SubscriptionInfo } from '../../../../shared/types';
import {
  initialSubscriptionOffer,
  matchesSubscriptionQuote,
  subscriptionOffers,
} from '../../../../shared/utils/subscriptionPresentation';
import { subscriptionCount, subscriptionQuoteError } from '../../utils/subscriptionPricingText';

export function useSubscriptionCalculator(sub: SubscriptionInfo | undefined, enabled: boolean) {
  const session = captureDataSession();
  const owner = `${session.key}:${session.generation}`;
  const initial = {
    owner,
    selectedId: undefined as string | undefined,
    period: 'monthly' as 'monthly' | 'yearly',
    employees: null as string | null,
    points: null as string | null,
    minimumEmployees: 1,
    minimumPoints: 1,
  };
  const [stored, setStored] = useState(initial);
  const state = stored.owner === owner ? stored : initial;
  const update = (patch: Partial<typeof initial>) =>
    setStored((previous) => ({ ...(previous.owner === owner ? previous : initial), ...patch }));
  const offers = subscriptionOffers(sub);
  const candidateId = state.selectedId ?? initialSubscriptionOffer(sub);
  const plan = offers.find((candidate) => candidate.id === candidateId);
  const planId = plan?.id;
  const pricing = plan?.pricing;
  const actualEmployees = Math.max(1, sub?.usage?.employees ?? sub?.currentUsers ?? 1, state.minimumEmployees);
  const actualPoints = Math.max(1, sub?.usage?.billablePoints ?? 1, state.minimumPoints);
  const employees = state.employees ?? String(Math.max(actualEmployees, pricing?.includedEmployees ?? 1));
  const points = state.points ?? String(actualPoints);
  const employeeCount = subscriptionCount(employees),
    pointCount = subscriptionCount(points);
  const valid = !!employeeCount && !!pointCount && employeeCount >= actualEmployees && pointCount >= actualPoints;
  const period = state.period;
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
  const failure = subscriptionQuoteError(quote.error);
  useEffect(() => {
    if (failure?.data?.code === 'COUNT_BELOW_USAGE')
      setStored((previous) => ({
        ...(previous.owner === owner
          ? previous
          : { owner, selectedId: undefined, period: 'monthly' as const, employees: null, points: null }),
        minimumEmployees: failure.data?.minimumEmployees ?? 1,
        minimumPoints: failure.data?.minimumPoints ?? 1,
      }));
  }, [owner, failure]);
  const message = !valid
    ? `Укажите целые числа не меньше фактического состава: сотрудники ${actualEmployees}, филиалы ${actualPoints}.`
    : !planId
      ? ''
      : failure?.data?.code === 'UNPRICED_POINTS'
        ? 'Для нескольких филиалов выберите MAX. Количество филиалов сохранено.'
        : failure?.data?.code === 'COUNT_BELOW_USAGE'
          ? `Состав вырос: сотрудников не меньше ${failure.data.minimumEmployees}, филиалов не меньше ${failure.data.minimumPoints}. Обновите состав.`
          : failure?.data?.code === 'LEGACY_PLAN'
            ? 'Для этого тарифа расчёт по составу недоступен. Выберите другой тариф для сравнения.'
            : quote.isError
              ? 'Не удалось рассчитать стоимость. Повторите расчёт.'
              : '';
  return {
    offers,
    planId,
    plan,
    pricing,
    name: plan?.name,
    maxPlan: offers.find(
      (candidate) =>
        candidate.pricing?.code === 'max' &&
        candidate.pricing.extraPointMonthlyPrice != null &&
        candidate.id !== planId,
    ),
    unsupportedPoints: failure?.data?.code === 'UNPRICED_POINTS',
    setPlan: (selectedId: string) => update({ selectedId }),
    period,
    setPeriod: (next: 'monthly' | 'yearly') => update({ period: next }),
    employees,
    points,
    setEmployees: (next: string) => update({ employees: next }),
    setPoints: (next: string) => update({ points: next }),
    actualEmployees,
    actualPoints,
    quote,
    message,
    valid,
    ready:
      enabled &&
      valid &&
      matchesSubscriptionQuote(quote.data, planId, period, employeeCount, pointCount) &&
      !quote.isFetching &&
      !quote.isError,
  };
}
