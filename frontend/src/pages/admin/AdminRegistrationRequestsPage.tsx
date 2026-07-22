import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Inbox,
  Building2,
  User,
  Phone,
  MessageSquare,
  Calendar,
  Check,
  X,
  Loader2,
  ExternalLink,
  Ban,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, addDays, differenceInCalendarDays } from 'date-fns';
import { ru } from 'date-fns/locale';

import { adminApi } from '../../api/services';
import { RegistrationRequest } from '../../types';
import Modal from '../../components/Modal';
import QueryState from '../../components/QueryState';
import { AdminPageHeader, Segmented } from '../../components/admin/adminUi';
import { formatPhone } from '../../../../shared/validation/phone';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Ожидают' },
  { key: 'approved', label: 'Одобрены' },
  { key: 'rejected', label: 'Отклонены' },
  { key: 'all', label: 'Все' },
];

const statusMeta: Record<RegistrationRequest['status'], { label: string; badge: string }> = {
  pending: { label: 'Ожидает', badge: 'badge-yellow' },
  approved: { label: 'Одобрена', badge: 'badge-green' },
  rejected: { label: 'Отклонена', badge: 'badge-red' },
};

// Quick trial presets — each sets the access end date N days from today.
const TRIAL_PRESETS = [7, 14, 30, 90];

export default function AdminRegistrationRequestsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StatusFilter>('pending');

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
    <div>
      <AdminPageHeader title="Заявки на регистрацию" subtitle="Самостоятельные заявки автосервисов со страницы входа" />

      {/* Status filter */}
      <div className="mb-5">
        <Segmented<StatusFilter>
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.key, label: f.label }))}
        />
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить заявки"
        isEmpty={list.length === 0}
        empty={{
          icon: Inbox,
          title: 'Заявок нет',
          description:
            filter === 'pending' ? 'Новые заявки на регистрацию появятся здесь' : 'В этой категории пока пусто',
        }}
        minHeight="min-h-[40vh]"
      >
        <div className="space-y-3">
          {list.map((req) => {
            const meta = statusMeta[req.status];
            return (
              <div key={req.id} className="card card-body">
                {/* Top row: company + status + actions */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
                      <Building2 className="h-5 w-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-gray-900">{req.companyName}</span>
                        <span className={meta.badge}>{meta.label}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(parseISO(req.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                      </div>
                    </div>
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => openApprove(req)} className="btn-primary btn-sm">
                        <Check className="h-4 w-4" />
                        Принять
                      </button>
                      <button onClick={() => openReject(req)} className="btn-secondary btn-sm">
                        <X className="h-4 w-4" />
                        Отклонить
                      </button>
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="text-gray-700">{req.ownerName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="tabular-nums text-gray-700">{formatPhone(req.phone)}</span>
                  </div>
                  {req.comment && (
                    <div className="flex items-start gap-2 text-sm sm:col-span-2">
                      <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                      <span className="text-gray-600">{req.comment}</span>
                    </div>
                  )}
                </div>

                {/* Rejected reason */}
                {req.status === 'rejected' && req.rejectReason && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <Ban className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>Причина отказа: {req.rejectReason}</span>
                  </div>
                )}

                {/* Approved → link to the created tenant */}
                {req.status === 'approved' && req.createdTenantId && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <Link
                      to={`/admin/tenants/${req.createdTenantId}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Открыть автосервис
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </QueryState>

      {/* Approve Modal — set the free trial window */}
      <Modal isOpen={!!approveTarget} onClose={() => setApproveTarget(null)} title="Одобрить заявку" size="sm">
        {approveTarget && (
          <div className="space-y-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-sm font-semibold text-gray-900">{approveTarget.companyName}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {approveTarget.ownerName} · {formatPhone(approveTarget.phone)}
              </p>
            </div>

            <p className="text-sm text-gray-500">
              Будет создан автосервис и владелец. Доступ откроется бесплатно на выбранный срок.
            </p>

            {/* Quick presets */}
            <div>
              <label className="label">Пробный период</label>
              <div className="grid grid-cols-4 gap-2">
                {TRIAL_PRESETS.map((d) => {
                  const presetDate = format(addDays(new Date(), d), 'yyyy-MM-dd');
                  const active = approveUntil === presetDate;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setApproveUntil(presetDate)}
                      className={`rounded-lg border px-2 py-2 text-sm font-medium transition-all ${
                        active
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {d} дн.
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Explicit end date */}
            <div>
              <label className="label">Доступ до</label>
              <input
                type="date"
                className="input tabular-nums"
                value={approveUntil}
                min={todayStr}
                onChange={(e) => setApproveUntil(e.target.value)}
              />
              {approveUntil && !approveValid ? (
                <p className="mt-1 text-xs text-red-600">Дата должна быть в будущем.</p>
              ) : (
                approveValid && (
                  <p className="mt-1 text-xs text-gray-400">
                    Доступ на {approveDays} {plural(approveDays)}.
                  </p>
                )
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-2">
              <button type="button" onClick={() => setApproveTarget(null)} className="btn-secondary">
                Отмена
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={!approveValid || approveMutation.isPending}
                className="btn-primary"
              >
                {approveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Создание…
                  </>
                ) : (
                  'Создать автосервис'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject Modal — optional reason */}
      <Modal isOpen={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Отклонить заявку" size="sm">
        {rejectTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Заявка «{rejectTarget.companyName}» будет отклонена. Аккаунт не создаётся.
            </p>
            <div>
              <label className="label">Причина (необязательно)</label>
              <textarea
                className="input"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Например: некорректные данные"
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-2">
              <button type="button" onClick={() => setRejectTarget(null)} className="btn-secondary">
                Отмена
              </button>
              <button
                type="button"
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() || undefined })}
                disabled={rejectMutation.isPending}
                className="btn-danger"
              >
                {rejectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Отклонение…
                  </>
                ) : (
                  'Отклонить'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Russian plural for «день / дня / дней».
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}
