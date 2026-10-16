import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createManagerCabinetApi, createTenantsApi } from '../../../../shared/api/createServices';
import { createSessionBoundClient } from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { readStoredToken } from '../../utils/sessionToken';
import { parseSubscriptionCount } from '../../utils/subscriptionPricingText';
import type { ExtendSubscriptionRequest } from '../../api/services';
import type { SubscriptionQuotePreview } from '../../../../shared/types';
import { newUuid } from '../../utils/uuid';

export type RenewalPeriod = 'monthly' | 'yearly' | 'custom';
const errorBody = (error: unknown) =>
  (
    error as {
      response?: {
        status?: number;
        data?: { code?: string; message?: string; minimumEmployees?: number; minimumPoints?: number };
      };
    }
  )?.response;

/** An uncertain response retries the original collected amount, composition and UUID. */
export function useSubscriptionRenewal({
  open,
  tenantId,
  mode,
  legacyPrice,
  onSubmit,
}: {
  open: boolean;
  tenantId: string;
  mode: 'manager' | 'superadmin';
  legacyPrice: number;
  onSubmit: (request: ExtendSubscriptionRequest) => Promise<unknown>;
}) {
  const { token } = useAuth();
  const api = useMemo(
    () =>
      mode === 'manager'
        ? createManagerCabinetApi(createSessionBoundClient(token))
        : createTenantsApi(createSessionBoundClient(token)),
    [mode, token],
  );
  const [period, setPeriodState] = useState<RenewalPeriod>('monthly');
  const [employees, setEmployees] = useState<string>();
  const [points, setPoints] = useState<string>();
  const [minimumEmployees, setMinimumEmployees] = useState(1);
  const [minimumPoints, setMinimumPoints] = useState(1);
  const [planId, setPlanId] = useState<string>();
  const [amount, setAmountState] = useState('');
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState('');
  const [amountHint, setAmountHint] = useState('');
  const [fallback, setFallback] = useState('');
  const wasOpen = useRef(false);
  const previousOwner = useRef('');
  const dirtyAmount = useRef(false);
  const recalculate = useRef(false);
  const busy = useRef(false);
  const intent = useRef<{ owner: string; request: ExtendSubscriptionRequest; uncertain?: boolean } | null>(null);
  const owner = `${token}:${mode}:${tenantId}`;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const ownsSession = useCallback(() => currentOwner.current === owner && readStoredToken() === token, [owner, token]);
  useEffect(() => {
    if (open && (!wasOpen.current || previousOwner.current !== owner) && !intent.current) {
      setPeriodState('monthly');
      setEmployees(undefined);
      setPoints(undefined);
      setPlanId(undefined);
      setMinimumEmployees(1);
      setMinimumPoints(1);
      setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
      dirtyAmount.current = false;
      recalculate.current = false;
      setChanged(false);
      setMessage('');
      setAmountHint('');
      setFallback('');
    }
    wasOpen.current = open;
    previousOwner.current = owner;
  }, [open, legacyPrice, owner]);
  const employeesCount = employees === undefined ? undefined : parseSubscriptionCount(employees);
  const pointsCount = points === undefined ? undefined : parseSubscriptionCount(points);
  const countsValid =
    (employees === undefined || (employeesCount !== undefined && employeesCount >= minimumEmployees)) &&
    (points === undefined || (pointsCount !== undefined && pointsCount >= minimumPoints));
  const quoteQuery = useQuery<SubscriptionQuotePreview>({
    queryKey: ['subscription-renewal-quote', token, mode, tenantId, planId, period, employees, points],
    queryFn: async () =>
      (
        await api.getSubscriptionQuote(tenantId, {
          period: period === 'yearly' ? 'yearly' : 'monthly',
          employees: employeesCount,
          points: pointsCount,
        })
      ).data,
    enabled: open && !!token && !!tenantId && period !== 'custom' && countsValid,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: () => undefined,
  });
  const preview = quoteQuery.data;
  const matchesCounts = !!preview && employeesCount === preview.quote.employees && pointsCount === preview.quote.points;
  useEffect(() => {
    if (!open || !preview || quoteQuery.isFetching || !ownsSession() || intent.current) return;
    setPlanId(preview.planId);
    setMinimumEmployees(Math.max(1, preview.usage.employees));
    setMinimumPoints(Math.max(1, preview.usage.billablePoints));
    if (employees === undefined) setEmployees(String(Math.max(1, preview.usage.employees)));
    if (points === undefined) setPoints(String(Math.max(1, preview.usage.billablePoints)));
    if (matchesCounts && !dirtyAmount.current) {
      setAmountState(String(preview.quote.total));
      if (recalculate.current) {
        setAmountHint('Сумма обновлена по расчёту');
        recalculate.current = false;
      }
    }
  }, [open, preview, quoteQuery.isFetching, employees, points, matchesCounts, ownsSession]);
  useEffect(() => {
    const response = errorBody(quoteQuery.error);
    if (!open || !ownsSession() || intent.current) return;
    if (response?.data?.code === 'COUNT_BELOW_USAGE') {
      const e = response.data.minimumEmployees,
        p = response.data.minimumPoints;
      if (typeof e === 'number' && Number.isSafeInteger(e) && e >= 1) {
        setMinimumEmployees(e);
        setEmployees((old) => String(Math.max(parseSubscriptionCount(old ?? '') ?? 1, e)));
      }
      if (typeof p === 'number' && Number.isSafeInteger(p) && p >= 1) {
        setMinimumPoints(p);
        setPoints((old) => String(Math.max(parseSubscriptionCount(old ?? '') ?? 1, p)));
      }
      setMessage('Состав вырос. Количество обновлено до фактического; проверьте новый расчёт.');
    } else if (response?.data?.code === 'LEGACY_PLAN') {
      setPeriodState('custom');
      setFallback('Для прежнего тарифа доступно ручное продление: укажите фактическую сумму и дату.');
    }
  }, [open, quoteQuery.error, ownsSession]);
  const locked = sending || uncertain || (!!intent.current && intent.current.owner !== owner);
  const quoteReady = matchesCounts && countsValid && !quoteQuery.isFetching && !quoteQuery.isError && !changed;
  const setPeriod = (next: RenewalPeriod) => {
    if (next === period || changed || busy.current || intent.current) return;
    dirtyAmount.current = false;
    recalculate.current = true;
    setMessage('');
    setFallback('');
    setAmountHint('');
    if (next === 'custom') setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
    setPeriodState(next);
  };
  const changeCount = (kind: 'employees' | 'points', value: string) => {
    if (busy.current || intent.current) return;
    if (!changed) {
      dirtyAmount.current = false;
      recalculate.current = true;
    }
    setAmountHint('');
    (kind === 'employees' ? setEmployees : setPoints)(value);
  };
  const changeAmount = (value: string) => {
    if (busy.current || intent.current) return;
    dirtyAmount.current = true;
    setAmountHint('');
    setAmountState(value);
  };
  const send = async (request: ExtendSubscriptionRequest) => {
    if (busy.current || !ownsSession()) return;
    if (intent.current && intent.current.owner !== owner) {
      setMessage('Сессия или автосервис изменились. Вернитесь к исходному продлению, чтобы проверить результат.');
      return;
    }
    if (!intent.current) intent.current = { owner, request: { ...request, requestId: newUuid() } };
    busy.current = true;
    setSending(true);
    setMessage('');
    try {
      await onSubmit(intent.current.request);
      if (!ownsSession()) return;
      intent.current = null;
      setUncertain(false);
    } catch (error) {
      if (!ownsSession()) return;
      const response = errorBody(error);
      if (response?.status === 409 && response.data?.code === 'QUOTE_CHANGED') {
        intent.current = null;
        setUncertain(false);
        dirtyAmount.current = true;
        setChanged(true);
        setMessage('Состав или тариф изменился. Проверьте новый расчёт и фактическую сумму, затем подтвердите расчёт.');
        await quoteQuery.refetch();
      } else if (!response || (response.status ?? 0) >= 500) {
        if (intent.current) intent.current.uncertain = true;
        setUncertain(true);
        setMessage(
          'Результат продления пока неизвестен. Поля заблокированы: повторите тот же запрос, чтобы проверить результат без повторного платежа.',
        );
      } else if (intent.current?.uncertain || response.data?.code === 'REQUEST_ID_REUSED') {
        // A later access/rate-limit rejection says nothing about the first POST's durable result.
        if (intent.current) intent.current.uncertain = true;
        setUncertain(true);
        setMessage(
          'Результат исходного продления пока не подтверждён. Сумма, состав и номер запроса сохранены. Повторите тот же запрос после восстановления доступа; при конфликте номера обратитесь к администратору.',
        );
      } else {
        intent.current = null;
        setUncertain(false);
        setMessage(response.data?.message ?? 'Не удалось продлить подписку. Проверьте данные и повторите.');
      }
    } finally {
      busy.current = false;
      if (ownsSession()) setSending(false);
    }
  };
  return {
    period,
    setPeriod,
    amount,
    changeAmount,
    amountHint,
    employees: employees ?? '',
    points: points ?? '',
    changeEmployees: (value: string) => changeCount('employees', value),
    changePoints: (value: string) => changeCount('points', value),
    employeesCount,
    pointsCount,
    minimumEmployees,
    minimumPoints,
    countsValid,
    initializingCounts: employees === undefined || points === undefined,
    quoteQuery,
    quoteReady,
    sending,
    uncertain,
    locked,
    changed,
    message,
    fallback,
    send,
    acknowledgeChange: () => {
      if (matchesCounts && countsValid && !quoteQuery.isFetching && !quoteQuery.isError) {
        setChanged(false);
        setMessage('');
      }
    },
    canClose: () => !busy.current && !intent.current,
  };
}
