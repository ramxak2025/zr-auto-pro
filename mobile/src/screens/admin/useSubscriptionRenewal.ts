import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { managerApi, tenantsApi } from '../../api/services';
import type { ExtendSubscriptionRequest } from '../../../../shared/api/types';
import type { SubscriptionQuotePreview } from '../../../../shared/types';
import { generateClientRequestId } from '../../utils/offlineCheckQueue';

export type RenewalPeriod = 'monthly' | 'yearly' | 'custom';
const errorBody = (error: unknown) =>
  (error as { response?: { status?: number; data?: { code?: string; message?: string } } })?.response;

/** One form intent: an uncertain response must retry the same collected amount and request ID. */
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
  const [period, setPeriodState] = useState<RenewalPeriod>('monthly');
  const [amount, setAmountState] = useState('');
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  const wasOpen = useRef(false);
  const dirtyAmount = useRef(false);
  const busy = useRef(false);
  const intent = useRef<{ owner: string; request: ExtendSubscriptionRequest } | null>(null);
  const owner = `${mode}:${tenantId}`;
  useEffect(() => {
    if (open && !wasOpen.current && !intent.current) {
      setPeriodState('monthly');
      setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
      dirtyAmount.current = false;
      setChanged(false);
      setMessage('');
      setFallback('');
    }
    wasOpen.current = open;
  }, [open, legacyPrice]);
  const quoteQuery = useQuery<SubscriptionQuotePreview>({
    queryKey: ['subscription-renewal-quote', mode, tenantId, period],
    queryFn: async () =>
      (
        await (mode === 'manager'
          ? managerApi.getSubscriptionQuote(tenantId, { period: period === 'yearly' ? 'yearly' : 'monthly' })
          : tenantsApi.getSubscriptionQuote(tenantId, { period: period === 'yearly' ? 'yearly' : 'monthly' }))
      ).data,
    enabled: open && !!tenantId && period !== 'custom',
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: () => undefined,
  });
  useEffect(() => {
    if (open && quoteQuery.data && !quoteQuery.isFetching && !dirtyAmount.current && !intent.current)
      setAmountState(String(quoteQuery.data.quote.total));
  }, [open, quoteQuery.data, quoteQuery.isFetching]);
  useEffect(() => {
    const response = errorBody(quoteQuery.error);
    if (open && ['LEGACY_PLAN', 'UNPRICED_POINTS'].includes(response?.data?.code ?? '') && !intent.current) {
      setPeriodState('custom');
      setFallback(
        response?.data?.code === 'LEGACY_PLAN'
          ? 'Для прежнего тарифа доступно ручное продление: укажите фактическую сумму и дату.'
          : 'Стоимость дополнительных филиалов согласуется отдельно. Доступно ручное продление.',
      );
    }
  }, [open, quoteQuery.error]);
  const locked = sending || uncertain;
  const quoteReady = !!quoteQuery.data && !quoteQuery.isFetching && !quoteQuery.isError && !changed;
  const setPeriod = (next: RenewalPeriod) => {
    if (next === period || changed || busy.current || intent.current) return;
    dirtyAmount.current = false;
    setMessage('');
    setFallback('');
    if (next === 'custom') setAmountState(legacyPrice > 0 ? String(legacyPrice) : '');
    setPeriodState(next);
  };
  const changeAmount = (value: string) => {
    if (busy.current || intent.current) return;
    dirtyAmount.current = true;
    setAmountState(value);
  };
  const send = async (request: ExtendSubscriptionRequest) => {
    if (busy.current) return;
    if (intent.current && intent.current.owner !== owner) {
      setMessage('Автосервис изменился. Вернитесь к исходному продлению, чтобы проверить результат.');
      return;
    }
    if (!intent.current) intent.current = { owner, request: { ...request, requestId: generateClientRequestId() } };
    busy.current = true;
    setSending(true);
    setMessage('');
    try {
      await onSubmit(intent.current.request);
      intent.current = null;
      setUncertain(false);
    } catch (error) {
      const response = errorBody(error);
      if (response?.status === 409 && response.data?.code === 'QUOTE_CHANGED') {
        intent.current = null;
        setUncertain(false);
        dirtyAmount.current = true;
        setChanged(true);
        setMessage('Состав или тариф изменился. Проверьте новый расчёт и фактическую сумму, затем подтвердите расчёт.');
        await quoteQuery.refetch();
      } else if (!response || response.status! >= 500) {
        setUncertain(true);
        setMessage(
          'Результат продления пока неизвестен. Поля заблокированы: повторите тот же запрос, чтобы проверить результат без повторного платежа.',
        );
      } else {
        intent.current = null;
        setUncertain(false);
        setMessage(response.data?.message ?? 'Не удалось продлить подписку. Проверьте данные и повторите.');
      }
    } finally {
      busy.current = false;
      setSending(false);
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
    acknowledgeChange: () => {
      if (quoteQuery.data && !quoteQuery.isFetching && !quoteQuery.isError) {
        setChanged(false);
        setMessage('');
      }
    },
    canClose: () => !busy.current && !intent.current,
  };
}
