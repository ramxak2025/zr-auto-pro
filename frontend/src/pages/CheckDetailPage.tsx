import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Trash2,
  UserIcon,
  Car,
  Gauge,
  Wrench,
  MessageSquare,
  CheckCircle2,
  Clock,
  CreditCard,
  Banknote,
  TrendingUp,
  Package,
  ShieldCheck,
  Pencil,
  Printer,
  FileText,
  LayoutGrid,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { useVinEnabled } from '../hooks/useVinEnabled';
import { zoned } from '../utils/tenantTime';
import { carsApi, checksApi, myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import QueryState from '../components/QueryState';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { WorkStatusBadge, WorkStatusPicker, resolveColumn } from '../components/WorkStatusPicker';
import { CheckStatusBadge, PaymentBadge, PlateBadge } from '../components/checks/checkBadges';
import MoneyInput from '../components/checks/MoneyInput';
import VinText from '../components/checks/VinText';
import { carVin } from '../components/checks/vinUi';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Money } from '../ui/Money';
import { Field } from '../ui/Field';
import { Textarea } from '../ui/Textarea';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import type { Car as CarType, Check, CheckProductLine, CheckServiceLine, Tenant, WorkBoardColumn } from '../types';
import { generateReceiptPdf } from '../utils/generateReceiptPdf';
import { formatQty, formatQtyUnit } from '../utils/units';
import { generateOrderPdf } from '../utils/generateOrderPdf';
import { formatDayKey } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

/**
 * Денежные мутации чека (завершение отложенного, удаление) двигают деньги И
 * склад — единый список зависимых query-ключей (staleTime 2 мин иначе прячет
 * изменение до 2 минут). Зеркало MONEY_STOCK_QUERY_KEYS из CheckCreatePage.
 */
const MONEY_STOCK_QUERY_KEYS: readonly string[][] = [
  ['checks'],
  ['dashboard'],
  ['dashboard-v2'],
  ['dashboard-chart'],
  ['financial-report'],
  ['employee-ranking'],
  ['cashflow'],
  ['cash-shift'],
  ['salary-all'],
  ['salary-my'],
  ['salary'],
  ['employee-salary'],
  ['products'],
  ['products-all'],
  ['low-stock'],
  ['installments'],
];

/** SW-офлайн-очередь отвечает 202 {queued:true} — сервер запрос ещё НЕ видел. */
const isQueuedOffline = (res: { status?: number; data?: { queued?: boolean } } | undefined): boolean =>
  res?.status === 202 && res?.data?.queued === true;

type PayMethod = 'cash' | 'card' | 'cash_card';

/** Карточка-реквизит («Клиент», «Автомобиль», …): подпись, значение, опциональная ссылка. */
function InfoCard({
  icon: Icon,
  label,
  to,
  children,
}: {
  icon: typeof UserIcon;
  label: string;
  to?: string;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-3">
          <Icon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
          {label}
        </span>
        {to && (
          <ChevronRight
            className="h-4 w-4 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-1.5 min-w-0">{children}</div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          'group block min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
          focusRing,
        )}
      >
        {inner}
      </Link>
    );
  }
  return <div className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">{inner}</div>;
}

export default function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  // Дата/время чека и гейт «комментарий день в день» — в поясе автосервиса.
  const timeZone = useTenantTimezone();
  const vinEnabled = useVinEnabled();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');

  // ── Приём оплаты отложенного заказа (Round 14, режим «Кассир») ──────────
  // Форма вместо голой кнопки «Завершить»: скидка с живым пересчётом итога,
  // способ нал/карта/смешанная (авто-доводка сумм как в Кассе), кнопка
  // «Оплачено — N ₽» → PATCH {isDeferred:false, ...} — сервер пересчитывает.
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [payDiscount, setPayDiscount] = useState(0);
  const [payCash, setPayCash] = useState(0);
  const [payHydrated, setPayHydrated] = useState(false);

  const {
    data: check,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => {
      const res = await checksApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // Гидрация формы оплаты один раз при загрузке отложенного чека.
  useEffect(() => {
    if (!check || payHydrated || !check.isDeferred) return;
    setPayDiscount(check.discount ?? 0);
    setPayHydrated(true);
  }, [check, payHydrated]);

  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    staleTime: 5 * 60_000,
  });

  // Owner-configurable board columns (091) — drives the work-status chip + picker.
  const { data: boardColumns } = useQuery<WorkBoardColumn[]>({
    queryKey: ['checks', 'board-columns'],
    queryFn: async () => (await checksApi.boardColumns.list()).data,
    staleTime: 60_000,
  });
  const activeColumns = useMemo(
    () => (boardColumns ?? []).filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [boardColumns],
  );

  // 171 — VIN: проекция чека несёт только {id, plateNumber, makeModel}, поэтому
  // при включённой опции подтягиваем карточку авто (тот же слот ['cars', id],
  // что инвалидируют формы авто). При выключенной опции запроса нет вовсе.
  const carId = check?.carId || check?.car?.id || '';
  const { data: carDetail } = useQuery<CarType>({
    queryKey: ['cars', carId],
    queryFn: async () => (await carsApi.getById(carId)).data,
    enabled: vinEnabled && !!carId,
    staleTime: 60_000,
  });
  const vin = vinEnabled ? (carVin(check?.car) ?? carVin(carDetail)) : null;

  // Активация отложенного чека = приём оплаты (Round 14): сервер пересчитывает
  // итог/ноги/скидку сам, гейтит кассира (403 «Только кассир…») и роль
  // (400 «Изменение назначенного заказа запрещено ролью») — тексты дословно.
  // Выбор пути по праву: держатель accept_payment идёт через выделенный
  // PATCH /checks/:id/accept-payment (пресет «Кассир» с edit='none' иначе
  // ловил бы 403 на гейте checks_edit; заодно кассир закрывает ЧУЖИЕ драфты);
  // остальные (легаси-мастер со своим драфтом, режим ВЫКЛ) — прежний
  // PATCH {isDeferred:false} под checks_edit, байт-в-байт.
  const acceptPaymentMutation = useMutation({
    mutationFn: (data: { paymentMethod: string; cashAmount: number; cardAmount: number; discount: number }) =>
      hasPermission('accept_payment')
        ? checksApi.acceptPayment(id!, {
            paymentMethod: data.paymentMethod as PayMethod,
            cashAmount: data.cashAmount,
            cardAmount: data.cardAmount,
            discount: data.discount,
          })
        : checksApi.update(id!, { isDeferred: false, ...data }),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        // SW-офлайн: сервер оплату ещё не видел — без «Оплата принята».
        toast('Нет сети — приём оплаты поставлен в очередь', { icon: '📡', duration: 5000 });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      // Закрытие отложенного чека списывает склад и двигает кассу.
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast.success('Оплата принята — чек проведён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Не удалось принять оплату');
    },
  });

  const workStatusMutation = useMutation({
    mutationFn: (workStatus: string) => checksApi.setWorkStatus(id!, workStatus),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        toast('Нет сети — смена статуса поставлена в очередь', { icon: '📡', duration: 5000 });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Статус работы обновлён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Не удалось изменить статус работы');
    },
  });

  // «Комментарий своего чека — день в день» (parity с mobile, round 7 item 10).
  // PATCH /checks/:id/comment: узкое послабление — ЛЮБОЙ сотрудник без
  // edit-permissions правит ТОЛЬКО комментарий СВОЕГО сегодняшнего чека
  // (включая проведённые). Сервер — единственный настоящий страж (свой +
  // сегодня по МСК); UI лишь прячет карандаш там, где заведомо откажут.
  // Комментарий не двигает деньги — инвалидируем только деталь + журнал.
  const commentMutation = useMutation({
    mutationFn: (comment: string) => checksApi.updateComment(id!, comment),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        setCommentModalOpen(false);
        toast('Нет сети — комментарий поставлен в очередь', { icon: '📡', duration: 5000 });
        return;
      }
      setCommentModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      toast.success('Комментарий сохранён');
    },
    onError: (err: any) => {
      // 403 «только в день создания» / 404 «не найден» — текст бэкенда
      // дословно: он точнее любого локального угадывания.
      toast.error(err?.response?.data?.message ?? 'Не удалось сохранить комментарий');
    },
  });

  const openCommentEditor = () => {
    setCommentDraft(check?.comment ?? '');
    setCommentModalOpen(true);
  };

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.remove(id!),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        // Уходим со страницы, чтобы не спровоцировать второй DELETE
        // (повторный replay уже удалённого чека упал бы в failed-store).
        toast('Нет сети — удаление поставлено в очередь и выполнится автоматически', { icon: '📡', duration: 5000 });
        navigate('/checks');
        return;
      }
      // Удаление возвращает товары на склад и вычитает чек из кассы/отчётов.
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast.success('Заказ-наряд перемещён в корзину (хранится 30 дней)');
      navigate('/checks');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Ошибка при удалении');
    },
  });

  // Колонки таблиц строк — до ранних return'ов (правила хуков).
  const serviceColumns = useMemo<DataTableColumn<CheckServiceLine>[]>(
    () => [
      { key: 'idx', header: '№', width: 48, render: (_s, i) => <span className="text-ink-3">{i + 1}</span> },
      { key: 'name', header: 'Услуга', render: (s) => <span className="font-medium text-ink">{s.name}</span> },
      { key: 'master', header: 'Мастер', hideBelow: 'md', render: (s) => s.master?.fullName ?? '—' },
      { key: 'price', header: 'Цена', numeric: true, hideBelow: 'sm', render: (s) => <Money value={s.price} /> },
      { key: 'qty', header: 'Кол-во', numeric: true, width: 88, render: (s) => formatQty(s.quantity) },
      {
        key: 'total',
        header: 'Итого',
        numeric: true,
        render: (s) => <Money value={s.total} className="font-semibold text-ink" />,
        footer: (rows) => <Money value={rows.reduce((sum, s) => sum + s.total, 0)} />,
      },
    ],
    [],
  );

  const productColumns = useMemo<DataTableColumn<CheckProductLine>[]>(
    () => [
      { key: 'idx', header: '№', width: 48, render: (_p, i) => <span className="text-ink-3">{i + 1}</span> },
      {
        key: 'name',
        header: 'Товар',
        render: (p) =>
          // Строка каталожного товара ведёт на склад с автооткрытием карточки
          // (round 12 #5, паритет мобилки); free-text без productId — статична.
          p.productId ? (
            <button
              type="button"
              onClick={() => navigate('/products', { state: { openProductId: p.productId } })}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-sm text-left font-medium text-ink hover:text-accent-text',
                focusRing,
              )}
              title="Открыть карточку товара на складе"
            >
              <span className="truncate">{p.name}</span>
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
            </button>
          ) : (
            <span className="font-medium text-ink">{p.name}</span>
          ),
      },
      { key: 'price', header: 'Цена', numeric: true, hideBelow: 'sm', render: (p) => <Money value={p.sellPrice} /> },
      {
        key: 'qty',
        header: 'Кол-во',
        numeric: true,
        width: 96,
        // 120: единица — ТОЛЬКО когда пришла: free-text строка без unit иначе
        // получала бы ложное «0.5 шт».
        render: (p) => (p.unit ? formatQtyUnit(p.quantity, p.unit) : formatQty(p.quantity)),
      },
      {
        key: 'total',
        header: 'Итого',
        numeric: true,
        render: (p) => <Money value={p.totalSell} className="font-semibold text-ink" />,
        footer: (rows) => <Money value={rows.reduce((sum, p) => sum + p.totalSell, 0)} />,
      },
    ],
    [navigate],
  );

  // Loading and a genuine fetch FAILURE are distinct: an errored request must
  // offer «Повторить», not silently fall through to the «Чек не найден» card
  // (which reads as a real 404). QueryState renders the loader, then the
  // error-with-retry; the not-found card below is reserved for a truly empty
  // successful response.
  if (isLoading || isError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Чек" backTo="/checks" />
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          isFetching={isFetching}
          minHeight="min-h-[50vh]"
          errorTitle="Не удалось загрузить чек"
        >
          <></>
        </QueryState>
      </div>
    );
  }

  if (!check) {
    return (
      <div className="space-y-5">
        <PageHeader title="Чек" backTo="/checks" />
        <EmptyState
          icon={FileText}
          title="Чек не найден"
          description="Возможно, он удалён или ссылка устарела"
          action={{ label: 'К журналу', onClick: () => navigate('/checks') }}
        />
      </div>
    );
  }

  // Гейт карандаша комментария: свой чек + сегодня + не возвращённый. Права
  // редактирования НЕ требуются. «Сегодня» считаем по КАЛЕНДАРЮ АВТОСЕРВИСА —
  // ровно тем же, каким сервер проверяет это в WHERE своего UPDATE.
  const isOwnCheck = !!user?.id && check.masterId === user.id;
  const isCheckToday = formatDayKey(check.date, timeZone) === formatDayKey(new Date(), timeZone);
  const canQuickEditComment = isOwnCheck && isCheckToday && !check.isReturned;

  // Живой пересчёт формы приёма оплаты (скидка — только на товары, как в
  // Кассе; авто-доводка: нал → всё налом, карта → всё картой, смешанная —
  // ввод нала, карта добивается до итога). Сервер пересчитает ещё раз сам.
  const payProductTotal = check.productTotal ?? 0;
  const appliedPayDiscount = Math.min(payDiscount, payProductTotal);
  const payTotal = (check.serviceTotal ?? 0) + Math.max(payProductTotal - appliedPayDiscount, 0);
  const finalPayCash = payMethod === 'cash' ? payTotal : payMethod === 'card' ? 0 : Math.min(payCash, payTotal);
  const finalPayCard =
    payMethod === 'card' ? payTotal : payMethod === 'cash' ? 0 : Math.max(payTotal - finalPayCash, 0);

  const canDelete = hasPermission('checks_delete') && !(user?.role === 'master' && check.isDeferred);
  const dateLabel = format(zoned(check.date, timeZone), 'd MMMM yyyy', { locale: ru });
  const timeLabel = format(zoned(check.date, timeZone), 'HH:mm', { locale: ru });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Чек №${check.number}`}
        backTo="/checks"
        subtitle={`${dateLabel} · ${timeLabel}${check.master?.fullName ? ` · ${check.master.fullName}` : ''}${check.point?.name ? ` · ${check.point.name}` : ''}`}
        meta={
          <>
            <CheckStatusBadge check={check} />
            {check.isWarranty && (
              <Badge tone="warn" icon={ShieldCheck}>
                Гарантия
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={FileText}
              onClick={() => generateOrderPdf(check, company || user?.tenant, { vin })}
            >
              Заказ-наряд
            </Button>
            <IconButton
              label="Печать чека"
              icon={Printer}
              variant="secondary"
              onClick={() => generateReceiptPdf(check, company || user?.tenant)}
            />
            {check.isDeferred && (
              <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/checks/${check.id}/edit`)}>
                Редактировать
              </Button>
            )}
            {canDelete && (
              <IconButton
                label="Удалить чек"
                icon={Trash2}
                variant="danger"
                onClick={() => setShowDeleteDialog(true)}
              />
            )}
          </>
        }
      />

      {check.isDeferred && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-warn-text">Чек отложен — это черновик</p>
            <p className="mt-0.5 text-warn-text/90">
              Не учитывается в выручке и складе. Нажмите «Редактировать», чтобы дописать услуги или товары, или примите
              оплату ниже.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        <div className="space-y-5 xl:col-span-2">
          {/* Реквизиты */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard icon={UserIcon} label="Клиент" to={check.clientId ? `/clients/${check.clientId}` : undefined}>
              <p className="truncate text-sm font-semibold text-ink">
                {check.client?.fullName ?? 'Розничный покупатель'}
              </p>
              {check.client?.phone && <p className="mt-0.5 text-xs text-ink-3">{formatPhone(check.client.phone)}</p>}
            </InfoCard>
            <InfoCard
              icon={Car}
              label="Автомобиль"
              to={check.car && check.clientId ? `/clients/${check.clientId}` : undefined}
            >
              {check.car ? (
                <>
                  <p className="truncate text-sm font-semibold text-ink">{check.car.makeModel || '—'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {check.car.plateNumber && <PlateBadge plate={check.car.plateNumber} />}
                    {vin && <VinText vin={vin} size="sm" />}
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-3">—</p>
              )}
            </InfoCard>
            <InfoCard icon={Wrench} label="Мастер">
              <p className="truncate text-sm font-semibold text-ink">{check.master?.fullName ?? '—'}</p>
            </InfoCard>
            <InfoCard icon={Gauge} label="Пробег">
              <p className="text-sm font-semibold tabular-nums text-ink">
                {check.mileage ? `${check.mileage.toLocaleString('ru-RU')} км` : '—'}
              </p>
            </InfoCard>
          </div>

          {/* Услуги */}
          {check.services && check.services.length > 0 && (
            <Card padding="none">
              <CardHeader
                icon={Wrench}
                title="Услуги"
                as="h2"
                divider={false}
                actions={
                  <>
                    <Badge className="tabular-nums">{check.services.length}</Badge>
                    <Money value={check.serviceTotal} className="text-sm font-semibold text-ink" />
                  </>
                }
              />
              <DataTable
                bare
                columns={serviceColumns}
                rows={check.services}
                rowKey={(s, i) => s.id ?? i}
                caption="Услуги чека"
              />
            </Card>
          )}

          {/* Товары */}
          {check.products && check.products.length > 0 && (
            <Card padding="none">
              <CardHeader
                icon={Package}
                title="Товары"
                as="h2"
                divider={false}
                actions={
                  <>
                    <Badge className="tabular-nums">{check.products.length}</Badge>
                    <Money value={check.productTotal} className="text-sm font-semibold text-ink" />
                  </>
                }
              />
              <DataTable
                bare
                columns={productColumns}
                rows={check.products}
                rowKey={(p, i) => p.id ?? i}
                caption="Товары чека"
              />
            </Card>
          )}

          {/* Гарантии, выданные этим чеком */}
          {check.warrantyClaims && check.warrantyClaims.length > 0 && (
            <Card padding="none">
              <CardHeader
                icon={ShieldCheck}
                iconTone="warn"
                title="Гарантия выдана"
                as="h2"
                actions={
                  <Badge tone="warn" className="tabular-nums">
                    {check.warrantyClaims.length}
                  </Badge>
                }
              />
              <ul className="divide-y divide-line">
                {check.warrantyClaims.map((claim) => {
                  const expires = new Date(claim.expiresAt);
                  const used = !!claim.usedAt;
                  const expired = !used && expires < new Date();
                  return (
                    <li key={claim.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge tone={claim.kind === 'product' ? 'accent' : 'info'} size="sm">
                            {claim.kind === 'product' ? 'Товар' : 'Услуга'}
                          </Badge>
                          <p className="truncate text-sm font-medium text-ink">{claim.itemName || '—'}</p>
                        </div>
                        <p className="mt-1 text-xs text-ink-3">
                          {claim.warrantyDays} дн. · до {format(expires, 'd MMM yyyy', { locale: ru })}
                        </p>
                      </div>
                      {used ? (
                        <Badge>Использована</Badge>
                      ) : expired ? (
                        <Badge tone="bad">Истекла</Badge>
                      ) : (
                        <Badge tone="ok" dot>
                          Активна
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {/* Статус работы (доска) — ортогонален оплате */}
          <Card padding="none">
            <CardHeader
              icon={LayoutGrid}
              title="Статус работы"
              subtitle="Доска приёмки. Не влияет на оплату."
              as="h2"
              divider={false}
              actions={
                <>
                  <WorkStatusBadge
                    column={resolveColumn(check.workStatus, boardColumns)}
                    workStatus={check.workStatus}
                  />
                  {hasPermission('checks_edit') &&
                    (check.workStatus ? (
                      <WorkStatusPicker
                        value={check.workStatus}
                        columns={activeColumns}
                        disabled={workStatusMutation.isPending}
                        onChange={(key) => workStatusMutation.mutate(key)}
                        size="md"
                        className="w-48"
                      />
                    ) : (
                      <Button
                        variant="secondary"
                        icon={LayoutGrid}
                        onClick={() => activeColumns[0] && workStatusMutation.mutate(activeColumns[0].key)}
                        disabled={activeColumns.length === 0}
                        loading={workStatusMutation.isPending}
                        title={activeColumns.length === 0 ? 'Сначала настройте колонки доски' : undefined}
                      >
                        Поставить на доску
                      </Button>
                    ))}
                </>
              }
            />
          </Card>
        </div>

        <div className="space-y-5">
          {/* Приём оплаты отложенного заказа (Round 14, режим «Кассир») */}
          {check.isDeferred && (
            <Card padding="none" className="border-ok/30">
              <CardHeader
                icon={Banknote}
                iconTone="ok"
                title="Приём оплаты"
                subtitle="Заказ станет проведённым: склад спишется, деньги попадут в кассу"
                as="h2"
              />
              <CardBody className="space-y-4">
                <Field
                  label="Скидка на товары"
                  htmlFor="pay-discount"
                  hint={
                    payProductTotal > 0
                      ? `Товаров на ${payProductTotal.toLocaleString('ru-RU')} ₽`
                      : 'В чеке нет товаров — скидка не применяется'
                  }
                >
                  <MoneyInput
                    id="pay-discount"
                    value={payDiscount}
                    onCommit={setPayDiscount}
                    max={payProductTotal}
                    disabled={payProductTotal <= 0}
                    className="w-40"
                  />
                </Field>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink-2">Способ оплаты</p>
                  <SegmentedControl<PayMethod>
                    aria-label="Способ оплаты"
                    fullWidth
                    value={payMethod}
                    onChange={setPayMethod}
                    options={[
                      { value: 'cash', label: 'Наличные', icon: Banknote },
                      { value: 'card', label: 'Карта', icon: CreditCard },
                      { value: 'cash_card', label: 'Смешанная' },
                    ]}
                  />
                </div>
                {payMethod === 'cash_card' && (
                  <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                    <Field label="Наличными" htmlFor="pay-cash">
                      <MoneyInput id="pay-cash" value={payCash} onCommit={setPayCash} max={payTotal} />
                    </Field>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-3">Картой</span>
                      <Money value={finalPayCard} className="font-semibold text-ink" />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-line pt-3">
                  <span className="text-sm font-medium text-ink-2">К оплате</span>
                  <Money value={payTotal} className="text-lg font-semibold text-ink" />
                </div>
                <Button
                  fullWidth
                  size="lg"
                  icon={CheckCircle2}
                  loading={acceptPaymentMutation.isPending}
                  onClick={() =>
                    acceptPaymentMutation.mutate({
                      paymentMethod: payMethod,
                      cashAmount: finalPayCash,
                      cardAmount: finalPayCard,
                      discount: appliedPayDiscount,
                    })
                  }
                >
                  Оплачено — <Money value={payTotal} />
                </Button>
              </CardBody>
            </Card>
          )}

          {/* Итого */}
          <Card padding="none">
            <CardHeader title="Итого" as="h2" dense />
            <CardBody className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-3">Услуги</span>
                <Money value={check.serviceTotal} className="font-medium text-ink-2" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-3">Товары</span>
                <Money value={check.productTotal} className="font-medium text-ink-2" />
              </div>
              {(check.discount ?? 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-ink-3">Скидка на товары</span>
                  <Money value={-(check.discount ?? 0)} className="font-medium text-ink-2" />
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line pt-2.5">
                <span className="text-base font-semibold text-ink">{check.isWarranty ? 'По гарантии' : 'Выручка'}</span>
                <Money
                  value={check.totalRevenue}
                  className={cn('text-lg font-semibold', check.isReturned ? 'text-ink-3 line-through' : 'text-ink')}
                />
              </div>
              {hasPermission('profit_view') && (
                <div className="space-y-2 border-t border-dashed border-line pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-3">Себестоимость товаров</span>
                    <Money value={check.productCostTotal} className="text-ink-2" />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-3">Зарплата мастеров</span>
                    <Money value={check.serviceSalaryTotal} className="text-ink-2" />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <TrendingUp className="h-4 w-4 text-ink-4" aria-hidden="true" />
                      {check.isWarranty ? 'Убыток по гарантии' : 'Чистая прибыль'}
                    </span>
                    {check.isWarranty ? (
                      <Money value={-(check.warrantyLoss ?? 0)} colorize className="text-base font-semibold" />
                    ) : (
                      <Money value={check.profit} signed colorize className="text-base font-semibold" />
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Оплата */}
          <Card padding="none">
            <CardHeader title="Оплата" as="h2" dense actions={<PaymentBadge check={check} />} />
            <CardBody className="space-y-3 text-sm">
              {check.paymentMethod === 'cash_card' && (check.cashAmount > 0 || check.cardAmount > 0) ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-ink-3">
                      <Banknote className="h-4 w-4 text-ink-4" aria-hidden="true" />
                      Наличные
                    </span>
                    <Money value={check.cashAmount} className="font-medium text-ink-2" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-ink-3">
                      <CreditCard className="h-4 w-4 text-ink-4" aria-hidden="true" />
                      Карта
                    </span>
                    <Money value={check.cardAmount} className="font-medium text-ink-2" />
                  </div>
                </>
              ) : (
                <p className="text-ink-3">
                  {check.isDeferred
                    ? 'Оплата ещё не принята'
                    : check.acceptedByName
                      ? `Принял: ${check.acceptedByName}`
                      : 'Оплата проведена'}
                </p>
              )}

              {/* Комментарий. Карандаш — «день в день» правка комментария СВОЕГО чека. */}
              <div className="border-t border-line pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
                    <MessageSquare className="h-4 w-4 text-ink-4" aria-hidden="true" />
                    Комментарий
                  </span>
                  {canQuickEditComment && (
                    <IconButton
                      label={check.comment ? 'Изменить комментарий' : 'Добавить комментарий'}
                      icon={Pencil}
                      size="sm"
                      onClick={openCommentEditor}
                    />
                  )}
                </div>
                {check.comment ? (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
                    {check.comment}
                  </p>
                ) : canQuickEditComment ? (
                  <button
                    type="button"
                    onClick={openCommentEditor}
                    className={cn('mt-2 rounded-sm text-sm text-ink-3 hover:text-accent-text', focusRing)}
                  >
                    Добавить комментарий…
                  </button>
                ) : (
                  <p className="mt-2 text-sm text-ink-3">Без комментария</p>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Comment quick-edit — «день в день» правка комментария своего чека */}
      <Modal
        isOpen={commentModalOpen}
        onClose={() => setCommentModalOpen(false)}
        title={check.comment ? 'Изменить комментарий' : 'Добавить комментарий'}
        description="Комментарий своего чека можно менять только в день его создания."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCommentModalOpen(false)} disabled={commentMutation.isPending}>
              Отмена
            </Button>
            <Button onClick={() => commentMutation.mutate(commentDraft.trim())} loading={commentMutation.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <Field label="Комментарий" htmlFor="check-comment">
          <Textarea
            id="check-comment"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            rows={4}
            maxLength={2000}
            autoFocus
            placeholder="Что важно помнить об этом заказе…"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить чек"
        message={`Переместить чек №${check.number} в корзину? Товары вернутся на склад, чек уйдёт из кассы и отчётов. Восстановить можно в течение 30 дней.`}
        confirmText="В корзину"
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
