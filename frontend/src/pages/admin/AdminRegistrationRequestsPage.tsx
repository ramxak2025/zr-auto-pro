import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, Calendar, Check, ExternalLink, Inbox, MessageSquare, Phone, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns';

import { adminApi } from '../../api/services';
import { RegistrationRequest } from '../../types';
import { formatPhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import QueryState from '../../components/QueryState';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SkeletonCard } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { Toolbar } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { focusRing, type Tone } from '../../ui/tokens';
import { ToggleChip, formatDateRu } from '../../components/admin/adminUi';
import { pluralRu } from '../../components/knowledge/utils';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';
const FILTER_KEYS: StatusFilter[] = ['pending', 'approved', 'rejected', 'all'];

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'pending', label: 'Ожидают' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'all', label: 'Все' },
];

const statusMeta: Record<RegistrationRequest['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Ожидает', tone: 'warn' },
  approved: { label: 'Одобрена', tone: 'ok' },
  rejected: { label: 'Отклонена', tone: 'bad' },
};

// Quick trial presets — each sets the access end date N days from today.
const TRIAL_PRESETS = [7, 14, 30, 90];

const plural = (n: number) => pluralRu(n, 'день', 'дня', 'дней');

export default function AdminRegistrationRequestsPage() {
  const queryClient = useQueryClient();
  const uid = useId();
  // Фильтр статуса — в URL (?status=), F5 и «Назад» его сохраняют.
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const filter: StatusFilter = FILTER_KEYS.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'pending';
  const setFilter = (next: StatusFilter) => setParams(next === 'pending' ? {} : { status: next }, { replace: true });

  const [approveTarget, setApproveTarget] = useState<RegistrationRequest | null>(null);
  const [approveUntil, setApproveUntil] = useState(''); // YYYY-MM-DD

  const [rejectTarget, setRejectTarget] = useState<RegistrationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const {
    data: requests,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['registration-requests', filter],
    queryFn: () => adminApi.listRegistrationRequests(filter === 'all' ? undefined : filter),
    select: (res) => res.data as RegistrationRequest[],
  });

  const invalidateAfterAction = () => {
    // Prefix match refreshes every status-filtered variant + the pending badge.
    queryClient.invalidateQueries({ queryKey: ['registration-requests'] });
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string; days: number }) =>
      adminApi.approveRegistrationRequest(id, { until }),
    onSuccess: (_res, variables) => {
      invalidateAfterAction();
      toast.success(`Автосервис создан, доступ на ${variables.days} ${plural(variables.days)}`);
      setApproveTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось одобрить заявку');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminApi.rejectRegistrationRequest(id, reason ? { reason } : undefined),
    onSuccess: () => {
      invalidateAfterAction();
      toast.success('Заявка отклонена');
      setRejectTarget(null);
      setRejectReason('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось отклонить заявку');
    },
  });

  const openApprove = (req: RegistrationRequest) => {
    setApproveTarget(req);
    setApproveUntil(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  };

  const openReject = (req: RegistrationRequest) => {
    setRejectTarget(req);
    setRejectReason('');
  };

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const approveDays = approveUntil ? differenceInCalendarDays(parseISO(approveUntil), new Date()) : 0;
  const approveValid = !!approveUntil && approveUntil > todayStr;

  const handleApprove = () => {
    if (!approveTarget) return;
    if (!approveValid) {
      toast.error('Укажите дату окончания в будущем');
      return;
    }
    approveMutation.mutate({ id: approveTarget.id, until: approveUntil, days: approveDays });
  };

  const list = requests ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Заявки" icon={Inbox} subtitle="Заявки на подключение автосервисов со страницы входа" />

      <Toolbar>
        <SegmentedControl<StatusFilter>
          aria-label="Статус заявки"
          value={filter}
          onChange={setFilter}
          options={FILTERS}
        />
      </Toolbar>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : (
        <QueryState
          isLoading={false}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          errorTitle="Не удалось загрузить заявки"
          isEmpty={list.length === 0}
          empty={{
            icon: Inbox,
            title: 'Заявок нет',
            description:
              filter === 'pending' ? 'Новые заявки на подключение появятся здесь' : 'В этой категории пока пусто',
          }}
          minHeight="py-14"
        >
          <ul className="space-y-3" aria-label="Заявки на подключение">
            {list.map((req) => {
              const meta = statusMeta[req.status];
              return (
                <li key={req.id}>
                  <Card as="article" padding="md">
                    {/* Верхняя строка: компания + статус + действия */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          <Building2 className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-md font-semibold text-ink">{req.companyName}</h2>
                            <Badge tone={meta.tone} dot>
                              {meta.label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs tabular-nums text-ink-3">
                            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                            {formatDateRu(req.createdAt, 'd MMMM yyyy, HH:mm')}
                          </p>
                        </div>
                      </div>

                      {req.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <Button variant="soft" size="sm" icon={Check} onClick={() => openApprove(req)}>
                            Принять
                          </Button>
                          <Button variant="secondary" size="sm" icon={X} onClick={() => openReject(req)}>
                            Отклонить
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Детали */}
                    <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                        <dt className="sr-only">Владелец</dt>
                        <dd className="text-ink-2">{req.ownerName}</dd>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                        <dt className="sr-only">Телефон</dt>
                        <dd>
                          <a
                            href={`tel:${req.phone}`}
                            className={cn('rounded tabular-nums text-ink-2 hover:text-accent-text', focusRing)}
                          >
                            {formatPhone(req.phone)}
                          </a>
                        </dd>
                      </div>
                      {req.comment && (
                        <div className="flex items-start gap-2 text-sm sm:col-span-2">
                          <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                          <dt className="sr-only">Комментарий</dt>
                          <dd className="whitespace-pre-line text-ink-2">{req.comment}</dd>
                        </div>
                      )}
                    </dl>

                    {/* Причина отказа */}
                    {req.status === 'rejected' && req.rejectReason && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-bad/20 bg-bad-soft px-3 py-2.5 text-sm text-bad-text">
                        <Ban className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span>Причина отказа: {req.rejectReason}</span>
                      </div>
                    )}

                    {/* Одобрена → ссылка на созданный автосервис */}
                    {req.status === 'approved' && req.createdTenantId && (
                      <div className="mt-3 border-t border-line pt-3">
                        <Link
                          to={`/admin/tenants/${req.createdTenantId}`}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded text-sm font-medium text-accent-text hover:underline',
                            focusRing,
                          )}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          Открыть автосервис
                        </Link>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </QueryState>
      )}

      {/* Одобрить: пробный период */}
      <Modal
        isOpen={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        title="Одобрить заявку"
        description={approveTarget ? `${approveTarget.ownerName} · ${formatPhone(approveTarget.phone)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveTarget(null)} disabled={approveMutation.isPending}>
              Отмена
            </Button>
            <Button onClick={handleApprove} disabled={!approveValid} loading={approveMutation.isPending}>
              Создать автосервис
            </Button>
          </>
        }
      >
        {approveTarget && (
          <div className="space-y-4">
            <div className="rounded-lg bg-surface-2 px-3 py-2.5">
              <p className="text-sm font-semibold text-ink">{approveTarget.companyName}</p>
              <p className="mt-0.5 text-xs text-ink-3">
                Будет создан автосервис и аккаунт владельца. Доступ откроется бесплатно на выбранный срок.
              </p>
            </div>

            {/* Быстрые пресеты подставляют дату ниже */}
            <Field label="Пробный период">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Пробный период">
                {TRIAL_PRESETS.map((d) => {
                  const presetDate = format(addDays(new Date(), d), 'yyyy-MM-dd');
                  return (
                    <ToggleChip
                      key={d}
                      active={approveUntil === presetDate}
                      onClick={() => setApproveUntil(presetDate)}
                    >
                      {d} дн.
                    </ToggleChip>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Доступ до"
              htmlFor={`${uid}-until`}
              error={approveUntil && !approveValid ? 'Дата должна быть в будущем.' : undefined}
              hint={approveValid ? `Доступ на ${approveDays} ${plural(approveDays)}.` : undefined}
            >
              <Input
                id={`${uid}-until`}
                type="date"
                className="tabular-nums"
                value={approveUntil}
                min={todayStr}
                invalid={!!approveUntil && !approveValid}
                onChange={(e) => setApproveUntil(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Отклонить: причина (необязательно) */}
      <Modal
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Отклонить заявку"
        description={rejectTarget ? `«${rejectTarget.companyName}» — аккаунт не создаётся.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectTarget(null)} disabled={rejectMutation.isPending}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                rejectTarget && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() || undefined })
              }
              loading={rejectMutation.isPending}
            >
              Отклонить
            </Button>
          </>
        }
      >
        {rejectTarget && (
          <Field label="Причина (необязательно)" htmlFor={`${uid}-reason`}>
            <Textarea
              id={`${uid}-reason`}
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Например: некорректные данные"
            />
          </Field>
        )}
      </Modal>
    </div>
  );
}
