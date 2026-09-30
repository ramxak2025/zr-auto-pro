import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';

import { adminManagersApi } from '../../api/services';
import type { CreateManagerRequest } from '../../api/services';
import type { PlatformManager } from '../../types';
import { formatPhone, isCompletePhone, normalizePhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { MoneyExact, balanceCaption, balanceTextClass } from '../../components/admin/MoneyExact';
import { adminManagerKeys } from '../../components/admin/managerQueryKeys';
import { useAdminManagers } from '../../components/admin/useAdminManagers';
import { apiErrorCode, apiErrorMessage } from '../../components/admin/apiError';
import { formatPercent, parseDecimalInput, sanitizeDecimalInput } from '../../components/admin/numberInput';
import { maskPhoneInput } from '../../components/admin/phoneInput';

/*
 * Менеджеры платформы (раздел суперадмина): таблица со сводкой и баланс-долгом перед владельцем,
 * создание менеджера. Карточка с расчётами и клиентами — AdminManagerDetailPage.
 */

const DEFAULT_SHARE = '60';
const MIN_PASSWORD = 6;

interface ManagerFormData {
  fullName: string;
  phone: string;
  password: string;
  ownerSharePercent: string;
  note: string;
}

const emptyForm: ManagerFormData = {
  fullName: '',
  phone: '',
  password: '',
  ownerSharePercent: DEFAULT_SHARE,
  note: '',
};

export default function AdminManagersPage() {
  const queryClient = useQueryClient();
  const uid = useId();
  const formId = `${uid}-manager-form`;

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ManagerFormData>({ ...emptyForm });
  const [showErrors, setShowErrors] = useState(false);
  // Ответ 409 PHONE_TAKEN: показываем у поля телефона, пока его не поправят.
  const [phoneTaken, setPhoneTaken] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useAdminManagers();
  const managers = data ?? [];

  const shareNum = parseDecimalInput(form.ownerSharePercent);
  const errors = {
    fullName: form.fullName.trim() ? undefined : 'Введите имя менеджера.',
    phone: isCompletePhone(form.phone) ? undefined : 'Введите телефон полностью — это логин менеджера.',
    password: form.password.length >= MIN_PASSWORD ? undefined : `Пароль — не короче ${MIN_PASSWORD} символов.`,
    share: Number.isFinite(shareNum) && shareNum >= 0 && shareNum <= 100 ? undefined : 'Введите число от 0 до 100.',
  };
  const formValid = !errors.fullName && !errors.phone && !errors.password && !errors.share;
  // Пустое поле подсвечиваем только после попытки отправки, введённое неверно — сразу.
  const shown = (message: string | undefined, value: string) => (showErrors || value ? message : undefined);

  const createMutation = useMutation({
    mutationFn: (payload: CreateManagerRequest) => adminManagersApi.create(payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
      toast.success(`Менеджер «${res.data.fullName}» создан`);
      closeModal();
    },
    onError: (err) => {
      if (apiErrorCode(err) === 'PHONE_TAKEN') {
        setPhoneTaken(apiErrorMessage(err, 'Этот телефон уже занят другим пользователем платформы.'));
        return;
      }
      toast.error(apiErrorMessage(err, 'Не удалось создать менеджера'));
    },
  });

  const openCreate = () => {
    setForm({ ...emptyForm });
    setShowErrors(false);
    setPhoneTaken(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm({ ...emptyForm });
    setShowErrors(false);
    setPhoneTaken(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!formValid) return;
    createMutation.mutate({
      fullName: form.fullName.trim(),
      phone: normalizePhone(form.phone),
      password: form.password,
      ownerSharePercent: shareNum,
      note: form.note.trim() || undefined,
    });
  };

  const isSaving = createMutation.isPending;

  const columns: DataTableColumn<PlatformManager>[] = [
    {
      key: 'name',
      header: 'Имя',
      primary: true,
      truncate: true,
      sortable: true,
      sortValue: (m) => m.fullName,
      render: (m) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <UserCog className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-ink">{m.fullName}</span>
              {!m.isActive && (
                <Badge size="sm" tone="neutral">
                  Отключён
                </Badge>
              )}
            </span>
            <span className="block truncate text-xs font-normal tabular-nums text-ink-3 sm:hidden">
              {formatPhone(m.phone)}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Телефон',
      hideBelow: 'sm',
      render: (m) => <span className="whitespace-nowrap tabular-nums text-ink-2">{formatPhone(m.phone)}</span>,
    },
    {
      key: 'tenants',
      header: 'Клиентов',
      numeric: true,
      hideBelow: 'md',
      sortable: true,
      sortValue: (m) => m.tenantsCount,
      render: (m) => <span className="text-ink-2">{m.tenantsCount}</span>,
    },
    {
      key: 'active',
      header: 'Активных',
      numeric: true,
      hideBelow: 'md',
      sortable: true,
      sortValue: (m) => m.activeTenantsCount,
      render: (m) => <span className="text-ink-2">{m.activeTenantsCount}</span>,
    },
    {
      key: 'paid',
      header: 'Оплат за месяц',
      numeric: true,
      hideBelow: 'lg',
      sortable: true,
      sortValue: (m) => m.paidThisMonth,
      render: (m) => <MoneyExact value={m.paidThisMonth} className="text-ink-2" />,
    },
    {
      key: 'share',
      header: 'Доля владельца за месяц',
      numeric: true,
      hideBelow: 'lg',
      sortable: true,
      sortValue: (m) => m.ownerShareThisMonth,
      render: (m) => <MoneyExact value={m.ownerShareThisMonth} className="text-ink-2" />,
    },
    {
      key: 'balance',
      header: 'Баланс',
      numeric: true,
      sortable: true,
      sortValue: (m) => m.balance,
      render: (m) => (
        <span className="whitespace-nowrap">
          <span className="sr-only">{balanceCaption(m.balance, 'owner')}: </span>
          <MoneyExact value={m.balance} className={cn('font-semibold', balanceTextClass(m.balance))} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Менеджеры"
        icon={UserCog}
        subtitle={`Всего: ${managers.length}`}
        actions={
          <Button icon={Plus} onClick={openCreate}>
            Новый менеджер
          </Button>
        }
      />

      <DataTable
        caption="Менеджеры платформы"
        rows={managers}
        rowKey={(m) => m.id}
        rowHref={(m) => `/admin/managers/${m.id}`}
        rowLabel={(m) => `Открыть карточку менеджера «${m.fullName}»`}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить менеджеров"
        emptyState={{
          icon: UserCog,
          title: 'Менеджеров пока нет',
          description: 'Создайте менеджера — он будет заводить автосервисы и передавать вам долю с оплат.',
          action: { label: 'Создать', onClick: openCreate },
        }}
      />

      {managers.length > 0 && (
        <p className="text-xs text-ink-3">
          Баланс — доля владельца с оплат менеджера минус внесённые расчёты. Красным — менеджер должен владельцу.
        </p>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Новый менеджер"
        description="Сотрудник платформы без своего автосервиса: ведёт клиентов и передаёт вам долю с оплат."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              Создать
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Имя" htmlFor={`${uid}-name`} required error={shown(errors.fullName, form.fullName)}>
            <Input
              id={`${uid}-name`}
              autoComplete="off"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Иванов Иван"
              invalid={!!shown(errors.fullName, form.fullName)}
            />
          </Field>

          <Field
            label="Телефон (логин)"
            htmlFor={`${uid}-phone`}
            required
            error={phoneTaken ?? shown(errors.phone, form.phone)}
          >
            <Input
              id={`${uid}-phone`}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
              value={form.phone}
              onChange={(e) => {
                setPhoneTaken(null);
                setForm({ ...form, phone: maskPhoneInput(e.target.value) });
              }}
              placeholder="+7 (XXX) XXX-XX-XX"
              invalid={!!(phoneTaken ?? shown(errors.phone, form.phone))}
            />
          </Field>

          <Field
            label="Пароль"
            htmlFor={`${uid}-password`}
            required
            hint={`Минимум ${MIN_PASSWORD} символов. Передайте его менеджеру — потом пароль можно сменить в карточке.`}
            error={shown(errors.password, form.password)}
          >
            <Input
              id={`${uid}-password`}
              type="text"
              autoComplete="off"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              invalid={!!shown(errors.password, form.password)}
            />
          </Field>

          <Field
            label="Доля владельца"
            htmlFor={`${uid}-share`}
            required
            hint={
              !errors.share
                ? `С каждой платной оплаты менеджера ${formatPercent(shareNum)} % записывается в его долг вам, ${formatPercent(100 - shareNum)} % остаётся ему.`
                : undefined
            }
            error={shown(errors.share, form.ownerSharePercent)}
          >
            <Input
              id={`${uid}-share`}
              inputMode="decimal"
              maxLength={6}
              className="tabular-nums"
              value={form.ownerSharePercent}
              onChange={(e) => setForm({ ...form, ownerSharePercent: sanitizeDecimalInput(e.target.value) })}
              invalid={!!shown(errors.share, form.ownerSharePercent)}
              rightSlot={<span className="text-xs">%</span>}
            />
          </Field>

          <Field label="Заметка" htmlFor={`${uid}-note`} hint="Видна только вам.">
            <Textarea
              id={`${uid}-note`}
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Например: работает по Казани"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
