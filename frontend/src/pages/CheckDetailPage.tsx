import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Trash2,
  Calendar,
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
  ChevronRight,
  ChevronDown,
  Package,
  ShieldCheck,
  Pencil,
  Printer,
  FileText,
  LayoutGrid,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { zoned } from '../utils/tenantTime';
import toast from 'react-hot-toast';
import { checksApi, myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import QueryState from '../components/QueryState';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '../components/Modal';
import { WorkStatusBadge, WorkStatusPicker, resolveColumn } from '../components/WorkStatusPicker';
import type { Check, Tenant, WorkBoardColumn } from '../types';
import { generateReceiptPdf } from '../utils/generateReceiptPdf';
import { formatQty, formatQtyUnit } from '../utils/units';
import { generateOrderPdf } from '../utils/generateOrderPdf';
import { formatDayKey, formatMoney, paymentMethodLabels } from '../../../shared/utils/formatters';
import { formatPhone } from '../../../shared/validation/phone';

const paymentMethodIcons: Record<string, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  warranty: ShieldCheck,
  cash_card: CreditCard,
  installment: CreditCard,
};

const paymentMethodColors: Record<string, string> = {
  cash: 'text-green-600 bg-green-50',
  card: 'text-blue-600 bg-blue-50',
  warranty: 'text-yellow-600 bg-yellow-50',
  cash_card: 'text-gray-600 bg-gray-100',
  installment: 'text-violet-600 bg-violet-50',
};

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

export default function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  // Дата/время чека и гейт «комментарий день в день» — в поясе автосервиса.
  const timeZone = useTenantTimezone();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(true);
  const [productsOpen, setProductsOpen] = useState(true);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');

  // ── Приём оплаты отложенного заказа (Round 14, режим «Кассир») ──────────
  // Форма вместо голой кнопки «Завершить»: скидка с живым пересчётом итога,
  // способ нал/карта/смешанная (авто-доводка сумм как в Кассе), кнопка
  // «Оплачено — N ₽» → PATCH {isDeferred:false, ...} — сервер пересчитывает.
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'cash_card'>('cash');
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
  const activeColumns = (boardColumns ?? []).filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

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
            paymentMethod: data.paymentMethod as 'cash' | 'card' | 'cash_card',
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

  // Loading and a genuine fetch FAILURE are distinct: an errored request must
  // offer «Повторить», not silently fall through to the «Чек не найден» card
  // (which reads as a real 404). QueryState renders the loader, then the
  // error-with-retry; the not-found card below is reserved for a truly empty
  // successful response.
  if (isLoading || isError) {
    return (
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        minHeight="min-h-[60vh]"
        errorTitle="Не удалось загрузить чек"
      >
        <></>
      </QueryState>
    );
  }

  if (!check) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{'Чек не найден'}</p>
        <button onClick={() => navigate('/checks')} className="btn-primary mt-4">
          {'Назад к чекам'}
        </button>
      </div>
    );
  }

  const PaymentIcon = paymentMethodIcons[check.paymentMethod] ?? CreditCard;

  // Гейт карандаша комментария: свой чек + сегодня + не возвращённый. Права
  // редактирования НЕ требуются. «Сегодня» считаем по КАЛЕНДАРЮ АВТОСЕРВИСА —
  // ровно тем же, каким сервер проверяет это в WHERE своего UPDATE. Раньше
  // сравнение шло по календарю браузера, и у бухгалтера из другого региона
  // карандаш то появлялся на вчерашнем чеке, то исчезал на сегодняшнем.
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

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/checks')}
            className="btn-ghost btn-sm flex-shrink-0"
            aria-label="Назад к чекам"
            title="Назад к чекам"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="page-title whitespace-nowrap">
                {'Чек'} #{check.number}
              </h1>
              {check.isDeferred && (
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Отложен</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mt-0.5">
              <Calendar className="w-3.5 h-3.5" />
              <span>{format(zoned(check.date, timeZone), 'd MMMM yyyy', { locale: ru })}</span>
              <span className="text-gray-300">·</span>
              <Clock className="w-3.5 h-3.5" />
              <span>{format(zoned(check.date, timeZone), 'HH:mm', { locale: ru })}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Заказ-наряд / акт (A4 PDF) */}
          <button
            onClick={() => generateOrderPdf(check, company || user?.tenant)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-600 hover:text-violet-600 hover:border-violet-200 hover:bg-violet-50 transition-colors"
            title="Скачать заказ-наряд (PDF) для печати"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Заказ-наряд</span>
          </button>
          {/* Print receipt */}
          <button
            onClick={() => generateReceiptPdf(check, company || user?.tenant)}
            className="p-2.5 rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            title="Печать чека"
            aria-label="Печать чека"
          >
            <Printer className="w-4 h-4" />
          </button>
          {check.isDeferred && (
            <button
              type="button"
              onClick={() => navigate(`/checks/${check.id}/edit`)}
              className="flex items-center gap-2 rounded-xl bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-100 transition-colors"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Редактировать</span>
            </button>
          )}
          {hasPermission('checks_delete') && !(user?.role === 'master' && check.isDeferred) && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Удалить чек"
              aria-label="Удалить чек"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Deferred check banner */}
      {check.isDeferred && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700">Чек отложен (черновик)</p>
          <p className="text-xs text-red-500 mt-0.5">
            Не учитывается в статистике. Нажмите «Редактировать» чтобы дописать услуги или товары.
          </p>
        </div>
      )}

      {/* Приём оплаты отложенного заказа (Round 14, режим «Кассир») */}
      {check.isDeferred && (
        <div className="card card-body space-y-4 !border-green-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-4 h-4 text-green-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900">Приём оплаты</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Заказ станет проведённым: склад спишется, деньги попадут в кассу.
              </p>
            </div>
          </div>

          {/* Скидка на товары — живой пересчёт итога */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">Скидка на товары:</label>
            <input
              type="number"
              min={0}
              max={payProductTotal}
              value={payDiscount || ''}
              onChange={(e) => setPayDiscount(Math.min(Math.max(Number(e.target.value) || 0, 0), payProductTotal))}
              className="input text-sm w-28 text-right"
              placeholder="0"
            />
            <span className="text-xs text-gray-400">₽</span>
          </div>

          {/* Способ оплаты: нал / карта / смешанная */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setPayMethod('cash')}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                payMethod === 'cash'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Banknote className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Нал</span>
            </button>
            <button
              type="button"
              onClick={() => setPayMethod('card')}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                payMethod === 'card'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <CreditCard className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Карта</span>
            </button>
            <button
              type="button"
              onClick={() => setPayMethod('cash_card')}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                payMethod === 'cash_card'
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <CreditCard className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Смешанная</span>
            </button>
          </div>

          {/* Смешанная: ввод нала, карта добивается до итога автоматически */}
          {payMethod === 'cash_card' && (
            <div className="bg-purple-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-green-600" />
                  <label className="text-sm font-medium text-gray-700">Наличные:</label>
                </div>
                <input
                  type="number"
                  min={0}
                  max={payTotal}
                  value={payCash || ''}
                  onChange={(e) => setPayCash(Math.max(Number(e.target.value) || 0, 0))}
                  className="input w-36 text-right text-lg font-bold"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center justify-between border-t border-purple-200 pt-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-blue-600" />
                  <label className="text-sm font-medium text-gray-700">Карта:</label>
                </div>
                <span className="text-lg font-bold text-blue-600 tabular-nums">{formatMoney(finalPayCard)}</span>
              </div>
            </div>
          )}

          {/* Итог + кнопка */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-sm font-semibold text-gray-700">К оплате</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{formatMoney(payTotal)}</span>
          </div>
          <button
            type="button"
            onClick={() =>
              acceptPaymentMutation.mutate({
                paymentMethod: payMethod,
                cashAmount: finalPayCash,
                cardAmount: finalPayCard,
                discount: appliedPayDiscount,
              })
            }
            disabled={acceptPaymentMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-base font-bold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <CheckCircle2 className="w-5 h-5" />
            {acceptPaymentMutation.isPending ? 'Проведение…' : `Оплачено — ${formatMoney(payTotal)}`}
          </button>
        </div>
      )}

      {/* Work-status (kanban board) — orthogonal to payment / deferred state */}
      <div className="card card-body animate-fade-in-up" style={{ animationDelay: '0ms' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
              <LayoutGrid className="w-4 h-4 text-primary-600" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900">{'Статус работы'}</h2>
                <WorkStatusBadge column={resolveColumn(check.workStatus, boardColumns)} workStatus={check.workStatus} />
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{'Доска приёмки. Не влияет на оплату.'}</p>
            </div>
          </div>
          {hasPermission('checks_edit') && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {check.workStatus ? (
                <WorkStatusPicker
                  value={check.workStatus}
                  columns={activeColumns}
                  disabled={workStatusMutation.isPending}
                  onChange={(key) => workStatusMutation.mutate(key)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => activeColumns[0] && workStatusMutation.mutate(activeColumns[0].key)}
                  disabled={workStatusMutation.isPending || activeColumns.length === 0}
                  title={activeColumns.length === 0 ? 'Сначала настройте колонки доски' : undefined}
                  className="flex items-center gap-2 rounded-xl bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <LayoutGrid className="w-4 h-4" />
                  {'Поставить на доску'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info cards - Client, Car, Master, Mileage */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Client card - clickable */}
        {check.clientId ? (
          <Link
            to={`/clients/${check.clientId}`}
            className="stat-card animate-fade-in-up group hover:border-primary-200 hover:shadow-md transition-all"
            style={{ animationDelay: '0ms' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <span className="stat-label">{'Клиент'}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-400 transition-colors" />
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">{check.client?.fullName ?? '—'}</p>
            {check.client?.phone && <p className="text-xs text-gray-400 mt-0.5">{formatPhone(check.client.phone)}</p>}
          </Link>
        ) : (
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '0ms' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center">
                <UserIcon className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <span className="stat-label">{'Клиент'}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900">{'Розничный покупатель'}</p>
          </div>
        )}

        {/* Car card - clickable via client */}
        {check.car ? (
          <Link
            to={check.clientId ? `/clients/${check.clientId}` : '#'}
            className={`stat-card animate-fade-in-up group transition-all ${
              check.clientId ? 'hover:border-primary-200 hover:shadow-md' : ''
            }`}
            style={{ animationDelay: '80ms' }}
            onClick={(e) => {
              if (!check.clientId) e.preventDefault();
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Car className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <span className="stat-label">{'Автомобиль'}</span>
              </div>
              {check.clientId && (
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-400 transition-colors" />
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">{check.car.makeModel}</p>
            {check.car.plateNumber && <p className="text-xs text-gray-400 mt-0.5">{check.car.plateNumber}</p>}
          </Link>
        ) : (
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center">
                <Car className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <span className="stat-label">{'Автомобиль'}</span>
            </div>
            <p className="text-sm font-semibold text-gray-500">{'—'}</p>
          </div>
        )}

        {/* Master card */}
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '160ms' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <Wrench className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <span className="stat-label">{'Мастер'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{check.master?.fullName ?? '—'}</p>
        </div>

        {/* Mileage card */}
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Gauge className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <span className="stat-label">{'Пробег'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {check.mileage ? `${check.mileage.toLocaleString('ru-RU')} км` : '—'}
          </p>
        </div>
      </div>

      {/* Services - Accordion */}
      {check.services && check.services.length > 0 && (
        <div className="card overflow-hidden animate-fade-in-up" style={{ animationDelay: '320ms' }}>
          <button
            type="button"
            onClick={() => setServicesOpen(!servicesOpen)}
            className="w-full flex items-center justify-between px-4 py-3 sm:px-5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">{'Услуги'}</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {check.services.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700 tabular-nums">
                {formatMoney(check.serviceTotal)}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${servicesOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>
          {servicesOpen && (
            <div className="border-t border-gray-100">
              {/* Mobile: card layout */}
              <div className="sm:hidden divide-y divide-gray-50">
                {check.services.map((svc, idx) => (
                  <div key={svc.id ?? idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{svc.name}</p>
                        {svc.master?.fullName && <p className="text-xs text-gray-400 mt-0.5">{svc.master.fullName}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatMoney(svc.total)}</p>
                        {svc.quantity > 1 && (
                          <p className="text-xs text-gray-400 tabular-nums">
                            {svc.quantity} x {formatMoney(svc.price)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>{'Название'}</th>
                      <th>{'Мастер'}</th>
                      <th className="text-right">{'Цена'}</th>
                      <th className="text-center w-16">{'Кол-во'}</th>
                      <th className="text-right">{'Итого'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.services.map((svc, idx) => (
                      <tr key={svc.id ?? idx}>
                        <td className="text-gray-400">{idx + 1}</td>
                        <td className="font-medium">{svc.name}</td>
                        <td className="text-gray-600">{svc.master?.fullName ?? '—'}</td>
                        <td className="text-right text-gray-600 tabular-nums">{formatMoney(svc.price)}</td>
                        <td className="text-center text-gray-600 tabular-nums">{svc.quantity}</td>
                        <td className="text-right font-semibold tabular-nums">{formatMoney(svc.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Products - Accordion */}
      {check.products && check.products.length > 0 && (
        <div className="card overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <button
            type="button"
            onClick={() => setProductsOpen(!productsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 sm:px-5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">{'Товары'}</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {check.products.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700 tabular-nums">
                {formatMoney(check.productTotal)}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${productsOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>
          {productsOpen && (
            <div className="border-t border-gray-100">
              {/* Mobile: card layout. Строка каталожного товара (есть
                  productId) кликабельна — ведёт на склад с автооткрытием
                  карточки (round 12 #5, паритет мобилки); free-text строка
                  без productId остаётся статичной. */}
              <div className="sm:hidden divide-y divide-gray-50">
                {check.products.map((prod, idx) => (
                  <div
                    key={prod.id ?? idx}
                    className={`px-4 py-3 ${prod.productId ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}`}
                    {...(prod.productId
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          title: 'Открыть карточку товара на складе',
                          onClick: () => navigate('/products', { state: { openProductId: prod.productId } }),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter') navigate('/products', { state: { openProductId: prod.productId } });
                          },
                        }
                      : {})}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{prod.name}</p>
                        {/* 120: дробные количества — «0.5 м x 1 200 ₽» видно и
                            при quantity < 1, скрываем только ровно 1. Единица —
                            ТОЛЬКО когда пришла: free-text строка без unit иначе
                            получала бы ложное «0.5 шт». */}
                        {prod.quantity !== 1 && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {prod.unit ? formatQtyUnit(prod.quantity, prod.unit) : formatQty(prod.quantity)} x{' '}
                            {formatMoney(prod.sellPrice)}
                          </p>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 flex-shrink-0 tabular-nums">
                        {formatMoney(prod.totalSell)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>{'Название'}</th>
                      <th className="text-right">{'Цена'}</th>
                      <th className="text-center w-16">{'Кол-во'}</th>
                      <th className="text-right">{'Итого'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Строка каталожного товара кликабельна → карточка на
                        складе (round 12 #5); free-text без productId — нет. */}
                    {check.products.map((prod, idx) => (
                      <tr
                        key={prod.id ?? idx}
                        className={prod.productId ? 'cursor-pointer hover:bg-gray-50 transition-colors' : undefined}
                        title={prod.productId ? 'Открыть карточку товара на складе' : undefined}
                        onClick={
                          prod.productId
                            ? () => navigate('/products', { state: { openProductId: prod.productId } })
                            : undefined
                        }
                      >
                        <td className="text-gray-400">{idx + 1}</td>
                        <td className="font-medium">{prod.name}</td>
                        <td className="text-right text-gray-600 tabular-nums">{formatMoney(prod.sellPrice)}</td>
                        <td className="text-center text-gray-600 tabular-nums">
                          {prod.unit ? formatQtyUnit(prod.quantity, prod.unit) : formatQty(prod.quantity)}
                        </td>
                        <td className="text-right font-semibold tabular-nums">{formatMoney(prod.totalSell)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Warranty claims spawned by this check */}
      {check.warrantyClaims && check.warrantyClaims.length > 0 && (
        <div className="card overflow-hidden animate-fade-in-up" style={{ animationDelay: '440ms' }}>
          <div className="px-4 py-3 sm:px-5 border-b border-amber-100 bg-amber-50/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <h2 className="text-base font-semibold text-amber-900">Гарантия выдана</h2>
              <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                {check.warrantyClaims.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {check.warrantyClaims.map((claim) => {
              const expires = new Date(claim.expiresAt);
              const now = new Date();
              const used = !!claim.usedAt;
              const expired = !used && expires < now;
              return (
                <div key={claim.id} className="px-4 py-3 sm:px-5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                          claim.kind === 'product' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {claim.kind === 'product' ? 'Товар' : 'Услуга'}
                      </span>
                      <p className="text-sm font-medium text-gray-900 truncate">{claim.itemName || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500">{claim.warrantyDays} дн.</span>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-500">до {format(expires, 'd MMM yyyy', { locale: ru })}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 self-center">
                    {used ? (
                      <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        Использована
                      </span>
                    ) : expired ? (
                      <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                        Истекла
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        Активна
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary & Payment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Financial summary */}
        <div className="card card-body animate-fade-in-up" style={{ animationDelay: '480ms' }}>
          <h2 className="text-base font-semibold text-gray-900 mb-4">{'Итого'}</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{'Услуги'}</span>
              <span className="font-medium tabular-nums">{formatMoney(check.serviceTotal)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{'Товары'}</span>
              <span className="font-medium tabular-nums">{formatMoney(check.productTotal)}</span>
            </div>
            {(check.discount ?? 0) > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{'Скидка на товары'}</span>
                <span className="font-medium text-orange-500 tabular-nums">-{formatMoney(check.discount ?? 0)}</span>
              </div>
            )}
            <div className="border-t border-gray-100 pt-2.5 mt-2.5">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-gray-900">{'Выручка'}</span>
                <span className="text-lg font-bold text-primary-600 tabular-nums">
                  {formatMoney(check.totalRevenue)}
                </span>
              </div>
            </div>

            {hasPermission('profit_view') && (
              <div className="border-t border-dashed border-gray-200 pt-3 mt-3 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">{'Себестоимость товаров'}</span>
                  <span className="text-gray-500 tabular-nums">{formatMoney(check.productCostTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">{'Зарплата мастеров'}</span>
                  <span className="text-gray-500 tabular-nums">{formatMoney(check.serviceSalaryTotal)}</span>
                </div>
                <div className="flex justify-between items-center pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-bold text-gray-700">{'Чистая прибыль'}</span>
                  </div>
                  <span
                    className={`text-base font-bold tabular-nums ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}
                  >
                    {check.profit >= 0 ? '+' : ''}
                    {formatMoney(check.profit)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment method card */}
        <div className="card card-body animate-fade-in-up" style={{ animationDelay: '560ms' }}>
          <h2 className="text-base font-semibold text-gray-900 mb-4">{'Оплата'}</h2>
          <div
            className={`inline-flex items-center gap-2.5 rounded-xl px-4 py-3 ${paymentMethodColors[check.paymentMethod] ?? 'text-gray-600 bg-gray-100'}`}
          >
            <PaymentIcon className="w-5 h-5" />
            <span className="text-sm font-semibold">
              {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
            </span>
          </div>
          {check.paymentMethod === 'cash_card' && (check.cashAmount > 0 || check.cardAmount > 0) && (
            <div className="mt-4 space-y-2.5">
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Banknote className="w-4 h-4" />
                  <span>{'Наличные'}</span>
                </div>
                <span className="font-medium tabular-nums">{formatMoney(check.cashAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <CreditCard className="w-4 h-4" />
                  <span>{'Карта'}</span>
                </div>
                <span className="font-medium tabular-nums">{formatMoney(check.cardAmount)}</span>
              </div>
            </div>
          )}

          {/* Comment. Карандаш — «день в день» правка комментария СВОЕГО чека:
              виден и без edit-permissions, и на проведённых чеках (сервер
              принуждает «свой + сегодня»). Когда комментария нет, а правка
              доступна — ghost-строка «Добавить комментарий» на том же месте. */}
          {check.comment ? (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-gray-700">{'Комментарий'}</span>
                {canQuickEditComment && (
                  <button
                    type="button"
                    onClick={openCommentEditor}
                    className="p-1 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="Изменить комментарий"
                    aria-label="Изменить комментарий"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-sm text-amber-700 whitespace-pre-wrap bg-amber-50 rounded-lg p-3 border border-amber-100">
                {check.comment}
              </p>
            </div>
          ) : canQuickEditComment ? (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={openCommentEditor}
                className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-primary-600 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                {'Добавить комментарий'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Back button */}
      <div className="flex justify-start pt-2">
        <button onClick={() => navigate('/checks')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          {'Назад к чекам'}
        </button>
      </div>

      {/* Comment quick-edit — «день в день» правка комментария своего чека */}
      <Modal
        isOpen={commentModalOpen}
        onClose={() => setCommentModalOpen(false)}
        title={check.comment ? 'Изменить комментарий' : 'Добавить комментарий'}
        size="md"
      >
        <textarea
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          rows={4}
          maxLength={2000}
          autoFocus
          placeholder="Комментарий к чеку..."
          className="input w-full text-sm"
        />
        <p className="text-xs text-gray-400 mt-2">Комментарий своего чека можно менять только в день его создания.</p>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => setCommentModalOpen(false)} className="btn-secondary flex-1">
            {'Отмена'}
          </button>
          <button
            type="button"
            onClick={() => commentMutation.mutate(commentDraft.trim())}
            disabled={commentMutation.isPending}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {commentMutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={'Удалить чек'}
        message={`Переместить чек #${check.number} в корзину? Восстановить можно в течение 30 дней.`}
        confirmText={'Удалить'}
        variant="danger"
      />
    </div>
  );
}
