import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { managerApi, tenantsApi } from '../../api/services';
import type { ExtendSubscriptionRequest } from '../../../../shared/api/types';
import type { SubscriptionQuotePreview } from '../../../../shared/types';
import { generateClientRequestId } from '../../utils/offlineCheckQueue';
import { subscriptionCount, subscriptionQuoteError as errorBody } from '../../utils/subscriptionPricingText';
import { captureDataSession } from '../../contexts/dataSession';
import { captureRenewalSession, type RenewalSession } from './renewalSession';

export type RenewalPeriod = 'monthly' | 'yearly' | 'custom';
export function useSubscriptionRenewal({
  open,
  tenantId,
  mode,
  legacyPrice,
  onSubmit,
  onConfirmed,
}: {
  open: boolean;
  tenantId: string;
  mode: 'manager' | 'superadmin';
  legacyPrice: number;
  onSubmit: (request: ExtendSubscriptionRequest, session: RenewalSession) => Promise<unknown>;
  onConfirmed?: () => void;
}) {
  const [period, setPeriodState] = useState<RenewalPeriod>('monthly');
  const [amount, setAmountState] = useState('');
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  const [info, setInfo] = useState<SubscriptionQuotePreview | undefined>(undefined);
  const [employeeInput, setEmployeeInput] = useState<string | null>(null);
  const [pointInput, setPointInput] = useState<string | null>(null);
  const [minimums, setMinimums] = useState({ employees: 1, points: 1 });
  const wasOpen = useRef(false),
    dirtyAmount = useRef(false),
    busy = useRef(false),
    reprice = useRef(false);
  const mounted = useRef(true),
    operationRef = useRef<object | null>(null);
  const intent = useRef<{ owner: string; request: ExtendSubscriptionRequest; uncertain?: boolean } | null>(null);
  const owner = `${captureDataSession().generation}:${mode}:${tenantId}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const lastOwner = useRef(owner);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if ((open && !wasOpen.current && !intent.current) || lastOwner.current !== owner) {
      intent.current = null;
      operationRef.current = null;
      busy.current = false;
      setSending(false);
      setUncertain(false);
      setPeriodState('monthly');
      setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
      dirtyAmount.current = false;
      setInfo(undefined);
      setEmployeeInput(null);
      setPointInput(null);
      setMinimums({ employees: 1, points: 1 });
      setChanged(false);
      setMessage('');
      setFallback('');
    }
    lastOwner.current = owner;
    wasOpen.current = open;
  }, [open, owner, legacyPrice]);
  const minEmployees = Math.max(info?.usage.employees ?? 1, minimums.employees);
  const minPoints = Math.max(info?.usage.billablePoints ?? 1, minimums.points);
  const employees = employeeInput ?? (info ? String(Math.max(1, minEmployees)) : '');
  const points = pointInput ?? (info ? String(Math.max(1, minPoints)) : '');
  const employeeCount = subscriptionCount(employees),
    pointCount = subscriptionCount(points);
  const valid = !info || (!!employeeCount && !!pointCount && employeeCount >= minEmployees && pointCount >= minPoints);
  const quoteQuery = useQuery<SubscriptionQuotePreview>({
    queryKey: ['subscription-renewal-quote', owner, info?.planId, period, employeeCount, pointCount],
    queryFn: async () =>
      (
        await (mode === 'manager' ? managerApi : tenantsApi).getSubscriptionQuote(tenantId, {
          period: period === 'yearly' ? 'yearly' : 'monthly',
          ...(employeeCount ? { employees: employeeCount } : {}),
          ...(pointCount ? { points: pointCount } : {}),
        })
      ).data,
    enabled: open && !!tenantId && period !== 'custom' && valid,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: () => undefined,
  });
  const matches =
    !!quoteQuery.data &&
    quoteQuery.data.quote.period === period &&
    (!employeeCount || quoteQuery.data.quote.employees === employeeCount) &&
    (!pointCount || quoteQuery.data.quote.points === pointCount);
  useEffect(() => {
    if (open && quoteQuery.data && !quoteQuery.isFetching && !quoteQuery.isError) {
      setInfo(quoteQuery.data);
      if (matches) setFallback('');
      if (matches && !dirtyAmount.current && !intent.current) {
        setAmountState(String(quoteQuery.data.quote.total));
        if (reprice.current) {
          setMessage('Сумма обновлена по расчёту');
          reprice.current = false;
        }
      }
    }
  }, [open, quoteQuery.data, quoteQuery.isFetching, quoteQuery.isError, matches, period]);
  useEffect(() => {
    const response = errorBody(quoteQuery.error);
    if (!open || intent.current) return;
    if (response?.data?.code === 'COUNT_BELOW_USAGE') {
      setMinimums({ employees: response.data.minimumEmployees ?? 1, points: response.data.minimumPoints ?? 1 });
      setMessage(
        `Фактический состав вырос. Укажите сотрудников не меньше ${response.data.minimumEmployees}, филиалов не меньше ${response.data.minimumPoints}.`,
      );
    }
    if (response?.data?.code === 'LEGACY_PLAN') {
      setPeriodState('custom');
      setFallback('Для прежнего тарифа укажите фактическую сумму и дату.');
    } else if (response?.data?.code === 'UNPRICED_POINTS') {
      setFallback(
        'Для нескольких филиалов нужен MAX. Чтобы продлить вручную по согласованию, явно выберите «Своя дата». Состав сохранён.',
      );
    }
  }, [open, quoteQuery.error]);
  const locked = sending || uncertain;
  const quoteReady = !!info && matches && valid && !quoteQuery.isFetching && !quoteQuery.isError && !changed;
  const setPeriod = (next: RenewalPeriod) => {
    if (next === period || changed || busy.current || intent.current) return;
    dirtyAmount.current = false;
    reprice.current = true;
    setMessage('');
    setFallback('');
    if (next === 'custom') setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
    setPeriodState(next);
  };
  const changeCount = (kind: 'employees' | 'points', value: string) => {
    if (busy.current || intent.current) return;
    if (!changed) {
      dirtyAmount.current = false;
      reprice.current = true;
    }
    if (kind === 'employees') setEmployeeInput(value);
    else setPointInput(value);
  };
  const changeAmount = (value: string) => {
    if (busy.current || intent.current) return;
    dirtyAmount.current = true;
    setAmountState(value);
  };
  const send = async (request: ExtendSubscriptionRequest) => {
    if (busy.current) return;
    if (
      !intent.current &&
      request.type === 'paid' &&
      period !== 'custom' &&
      errorBody(quoteQuery.error)?.data?.code === 'UNPRICED_POINTS'
    )
      return;
    if (intent.current && intent.current.owner !== owner) return;
    const session = captureRenewalSession();
    if (!session.isCurrent()) return;
    if (!intent.current)
      intent.current = {
        owner,
        request: Object.freeze({
          ...request,
          ...(request.period && employeeCount && pointCount ? { employees: employeeCount, points: pointCount } : {}),
          requestId: generateClientRequestId(),
        }),
      };
    const operation = {};
    operationRef.current = operation;
    const ownsForm = () =>
      mounted.current && session.data.isCurrent() && ownerRef.current === owner && operationRef.current === operation;
    const current = () => ownsForm() && session.isCurrent();
    busy.current = true;
    setSending(true);
    setMessage('');
    try {
      await onSubmit(intent.current.request, session);
      if (!current()) {
        if (ownsForm()) {
          if (intent.current) intent.current.uncertain = true;
          setUncertain(true);
        }
        return;
      }
      intent.current = null;
      setUncertain(false);
      onConfirmed?.();
    } catch (error) {
      if (!current()) {
        if (ownsForm()) {
          if (intent.current) intent.current.uncertain = true;
          setUncertain(true);
        }
        return;
      }
      const response = errorBody(error);
      if (response?.status === 409 && response.data?.code === 'QUOTE_CHANGED') {
        intent.current = null;
        setUncertain(false);
        dirtyAmount.current = true;
        setChanged(true);
        setMessage('Состав или тариф изменился. Проверьте новый расчёт и фактическую сумму, затем подтвердите расчёт.');
        try {
          await quoteQuery.refetch();
        } catch {
          if (current())
            setMessage(
              'Не удалось обновить расчёт. Фактическая сумма сохранена; повторите загрузку и проверьте расчёт.',
            );
        }
        if (!current()) return;
      } else if (
        intent.current?.uncertain ||
        !response ||
        (response.status ?? 0) >= 500 ||
        response.data?.code === 'REQUEST_ID_REUSED'
      ) {
        if (intent.current) intent.current.uncertain = true;
        setUncertain(true);
        setMessage(
          'Результат неизвестен. Параметры сохранены и заблокированы. Повторите тот же запрос, чтобы проверить результат без повторного платежа.',
        );
      } else {
        intent.current = null;
        setUncertain(false);
        setMessage(response.data?.message ?? 'Не удалось продлить подписку. Проверьте данные.');
      }
    } finally {
      if (ownsForm()) {
        operationRef.current = null;
        busy.current = false;
        setSending(false);
      }
    }
  };
  return {
    period,
    setPeriod,
    amount,
    changeAmount,
    quoteQuery,
    quoteReady,
    sending,
    uncertain,
    locked,
    changed,
    message,
    fallback,
    send,
    employees,
    points,
    minEmployees,
    minPoints,
    changeEmployees: (value: string) => changeCount('employees', value),
    changePoints: (value: string) => changeCount('points', value),
    acknowledgeChange: () => {
      if (matches && valid && !quoteQuery.isFetching && !quoteQuery.isError) {
        setChanged(false);
        setMessage('');
      }
    },
    canClose: () => !busy.current && !intent.current,
  };
}
