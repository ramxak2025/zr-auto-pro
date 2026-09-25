import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Car, Gift, LayoutGrid, Receipt, Settings, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';

import { checksApi, loyaltyApi, myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { usePointsQuery } from '../hooks/usePoints';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Modal,
  Money,
  PageHeader,
  QueryState,
  Select,
  SkeletonCard,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
} from '../ui';
import type { TabItem } from '../ui';
import { ErrorRow } from '../components/dashboard/shared';
import StickySaveBar, { useUnsavedGuard } from '../components/company/StickySaveBar';
import ToggleRow from '../components/company/ToggleRow';
import VinSettingsCard from '../components/company/VinSettingsCard';
import type { LoyaltySettings, PaymentAcceptorInfo, PosSettings, PosSettingsConflict, Tenant } from '../types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { DEFAULT_TIMEZONE, RU_TIMEZONES, formatDateTime, timezoneOption } from '../../../shared/utils/formatters';

interface CompanyForm {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  receiptFooter: string;
  /** 157 — часовой пояс автосервиса (IANA-id). Дефолт — Москва. */
  timezone: string;
  /**
   * 156 — общая база клиентов всех филиалов. Выкл: у каждой точки свой список
   * клиентов. Дефолт true (`!== false`): у одноточечных тенантов поведение не
   * меняется, а сервер и так возвращает поле только в этом смысле.
   */
  pointsSharedClients: boolean;
}

function formFromCompany(company: Tenant): CompanyForm {
  return {
    name: company.name || '',
    phone: company.phone || '',
    address: company.address || '',
    email: company.email || '',
    description: company.description || '',
    legalName: company.legalName || '',
    inn: company.inn || '',
    kpp: company.kpp || '',
    ogrn: company.ogrn || '',
    receiptFooter: company.receiptFooter || '',
    timezone: company.timezone || DEFAULT_TIMEZONE,
    pointsSharedClients: company.pointsSharedClients !== false,
  };
}

const EMPTY_FORM: CompanyForm = {
  name: '',
  phone: '',
  address: '',
  email: '',
  description: '',
  legalName: '',
  inn: '',
  kpp: '',
  ogrn: '',
  receiptFooter: '',
  timezone: DEFAULT_TIMEZONE,
  pointsSharedClients: true,
};

type SettingsTab = 'company' | 'cars' | 'cash' | 'loyalty';

// ---------------------------------------------------------------------------
// POS «Кассовая смена + роли». Один тумблер под settings_manage: GET
// /checks/pos-settings читается любым, PATCH — settings_manage (волна
// Битрикс24). Переключение — сразу мутацией, без отдельного «Сохранить»;
// правила кассира проверяет сервер, тумблер лишь включает режим для тенанта.
// ---------------------------------------------------------------------------
function ShiftModeSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings_manage');
  // Round 14: 409 при переключении режима с незакрытым конвейером —
  // модал «Сначала закройте заказы (N)» со списком первых 10.
  const [conflict, setConflict] = useState<PosSettingsConflict | null>(null);

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<PosSettings>({
    queryKey: ['checks', 'pos-settings'],
    queryFn: async () => (await checksApi.getPosSettings()).data,
    enabled: canManage,
  });

  // 155 — «Кто принимает оплату»: активные сотрудники + резолв, кто сейчас
  // фактически принимает (по списку владельца либо по праву accept_payment).
  const {
    data: acceptors,
    isLoading: acceptorsLoading,
    isError: acceptorsError,
    isFetching: acceptorsFetching,
    refetch: refetchAcceptors,
  } = useQuery<PaymentAcceptorInfo[]>({
    queryKey: ['checks', 'payment-acceptors'],
    queryFn: async () => (await checksApi.paymentAcceptors()).data,
    enabled: canManage,
  });

  // Локальный черновик ручного выбора: null = правок нет (показываем серверное
  // состояние), Set = отмеченные вручную (owner-class в Set не входит — он
  // принимает всегда и из списка не убирается).
  const [acceptorDraft, setAcceptorDraft] = useState<Set<string> | null>(null);

  const acceptorsMutation = useMutation({
    mutationFn: (paymentAcceptorIds: string[] | null) => checksApi.updatePosSettings({ paymentAcceptorIds }),
    onSuccess: (_res, ids) => {
      queryClient.invalidateQueries({ queryKey: ['checks', 'pos-settings'] });
      queryClient.invalidateQueries({ queryKey: ['checks', 'payment-acceptors'] });
      setAcceptorDraft(null);
      toast.success(ids === null ? 'Режим «по ролям» восстановлен' : 'Список принимающих оплату сохранён');
    },
    // 409 и прочие ошибки сервера показываем его текстом (например, конфликт
    // включения режима) — без перевода в общий «Ошибка сохранения», если текст есть.
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения');
    },
  });

  const mutation = useMutation({
    mutationFn: (shiftModeEnabled: boolean) => checksApi.updatePosSettings({ shiftModeEnabled }),
    onSuccess: (_res, shiftModeEnabled) => {
      queryClient.setQueryData<PosSettings>(['checks', 'pos-settings'], (prev) =>
        prev ? { ...prev, shiftModeEnabled } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['checks', 'pos-settings'] });
      toast.success(shiftModeEnabled ? 'Режим кассовой смены включён' : 'Режим кассовой смены выключен');
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      // 409 = незакрытый конвейер (отложенные заказы на доске) — не ошибка
      // сохранения, а инструкция: показываем список, что закрыть.
      if (err?.response?.status === 409 && Array.isArray(data?.checks)) {
        setConflict(data as PosSettingsConflict);
        return;
      }
      toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения');
    },
  });

  if (!canManage) return null;

  const enabled = settings?.shiftModeEnabled ?? false;

  // 155: null/absent = режим «по ролям» (право «Приём оплаты» из матрицы);
  // массив = явный ручной список владельца (+ owner-class всегда).
  const serverAcceptorIds = settings?.paymentAcceptorIds ?? null;
  const manualMode = acceptorDraft !== null || Array.isArray(serverAcceptorIds);

  const startManual = () => {
    // Черновик стартует с фактических принимающих (без owner-class — они
    // «всегда могут» и в список не пишутся).
    setAcceptorDraft(
      new Set(
        (acceptors ?? [])
          .filter((a) => !a.isOwnerClass && (Array.isArray(serverAcceptorIds) ? a.selected : a.effective))
          .map((a) => a.id),
      ),
    );
  };

  const toggleAcceptor = (id: string) => {
    setAcceptorDraft((prev) => {
      const next = new Set(prev ?? (acceptors ?? []).filter((a) => !a.isOwnerClass && a.selected).map((a) => a.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAcceptorChecked = (a: PaymentAcceptorInfo) =>
    a.isOwnerClass || (acceptorDraft ? acceptorDraft.has(a.id) : a.selected);

  return (
    <Card padding="none">
      <CardHeader
        icon={Wallet}
        title="Режим кассовой смены"
        subtitle="Кто проводит оплату по заказ-наряду"
        actions={
          <Switch
            label="Режим кассовой смены"
            checked={enabled}
            onChange={(v) => mutation.mutate(v)}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        {isError ? (
          <ErrorRow message="Не удалось загрузить состояние режима" onRetry={() => refetch()} loading={isFetching} />
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm text-ink-2">
                {enabled
                  ? 'Оплату по заказ-наряду проводят только кассиры — сотрудники с правом «Приём оплаты». Мастер без этого права создаёт отложенный заказ-наряд без оплаты, а цена товара фиксируется по складу.'
                  : 'Выключено. Оплату по заказ-наряду может проводить любой сотрудник с доступом к кассе.'}
              </p>
              <p className="text-xs text-ink-3">
                Право «Приём оплаты (кассир)» назначается сотруднику в разделе «Пользователи».
              </p>
            </div>

            {/* 155 — «Кто принимает оплату»: режим «по ролям» либо явный список */}
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">Кто принимает оплату</h3>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {manualMode
                      ? 'Только отмеченные сотрудники. Директор и администратор владельца принимают всегда.'
                      : 'По ролям: сотрудники с правом «Приём оплаты» из матрицы роли.'}
                  </p>
                </div>
                {manualMode ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => acceptorsMutation.mutate(null)}
                    disabled={acceptorsMutation.isPending}
                  >
                    Сбросить к ролям
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={startManual}
                    disabled={acceptorsLoading || acceptorsError || acceptorsMutation.isPending}
                  >
                    Выбрать вручную
                  </Button>
                )}
              </div>

              {acceptorsLoading ? (
                <p className="py-2 text-xs text-ink-3" role="status">
                  Загружаем сотрудников…
                </p>
              ) : acceptorsError ? (
                <ErrorRow
                  message="Не удалось загрузить список сотрудников"
                  onRetry={() => refetchAcceptors()}
                  loading={acceptorsFetching}
                />
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {(acceptors ?? []).map((a) => {
                    const subtitle = `${a.roleName || '—'}${a.isOwnerClass ? ' · всегда может принимать' : ''}`;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        {manualMode ? (
                          <Checkbox
                            label={a.fullName || 'Без имени'}
                            description={subtitle}
                            checked={isAcceptorChecked(a)}
                            // owner-class — «всегда может», из списка не убирается.
                            disabled={a.isOwnerClass || acceptorsMutation.isPending}
                            onChange={() => toggleAcceptor(a.id)}
                          />
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-ink">{a.fullName || 'Без имени'}</p>
                              <p className="truncate text-xs text-ink-3">{subtitle}</p>
                            </div>
                            {a.effective ? (
                              <Badge tone="ok" dot>
                                Принимает
                              </Badge>
                            ) : (
                              <span className="flex-shrink-0 text-xs text-ink-3">Нет права</span>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {acceptorDraft !== null && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => acceptorsMutation.mutate([...acceptorDraft])}
                    loading={acceptorsMutation.isPending}
                  >
                    Сохранить список
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>

      {/* 409: незакрытые заказ-наряды на доске — режим переключать нельзя */}
      <Modal
        isOpen={!!conflict}
        onClose={() => setConflict(null)}
        title={`Сначала закройте заказы (${conflict?.count ?? 0})`}
        description="Режим нельзя переключить, пока на доске есть незакрытые заказ-наряды"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              Закрыть
            </Button>
            <Button
              icon={LayoutGrid}
              onClick={() => {
                setConflict(null);
                navigate('/work-board');
              }}
            >
              Перейти на Доску
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-2">Примите по ним оплату и выдайте — или снимите с доски.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {(conflict?.checks ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Заказ #{c.number}</p>
                  <p className="truncate text-xs text-ink-3">{c.clientName ?? 'Розничный покупатель'}</p>
                </div>
                <Money value={c.totalRevenue} className="text-sm font-semibold text-ink" />
              </li>
            ))}
          </ul>
          {(conflict?.count ?? 0) > (conflict?.checks?.length ?? 0) && (
            <p className="text-xs text-ink-3">
              Показаны первые {conflict?.checks?.length ?? 0} из {conflict?.count ?? 0}.
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Программа лояльности (settings_manage)
// ---------------------------------------------------------------------------
function LoyaltySettingsSection() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Backend PATCH /loyalty/settings → settings_manage (волна Битрикс24).
  const canManage = hasPermission('settings_manage');
  const idBase = useId();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<LoyaltySettings>({
    queryKey: ['loyalty', 'settings'],
    queryFn: async () => (await loyaltyApi.getSettings()).data,
    enabled: canManage,
  });

  const [form, setForm] = useState<{ enabled: boolean; accrualPercent: number; redeemMaxPercent: number }>({
    enabled: false,
    accrualPercent: 0,
    redeemMaxPercent: 0,
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled,
        accrualPercent: settings.accrualPercent,
        redeemMaxPercent: settings.redeemMaxPercent,
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { enabled?: boolean; accrualPercent?: number; redeemMaxPercent?: number }) =>
      loyaltyApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['loyalty', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['loyalty', 'settings'] });
      toast.success('Программа лояльности сохранена');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  if (!canManage) return null;

  const clampPercent = (raw: string): number => {
    const n = Math.round(Number(raw.replace(',', '.')));
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  };

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    mutation.mutate({
      enabled: form.enabled,
      accrualPercent: form.accrualPercent,
      redeemMaxPercent: form.redeemMaxPercent,
    });
  };

  const percentSlot = <span className="text-sm text-ink-3">%</span>;

  return (
    <Card padding="none">
      <CardHeader
        icon={Gift}
        title="Программа лояльности"
        subtitle="Бонусы за покупки и оплата ими"
        actions={
          <Switch
            label="Программа лояльности"
            checked={form.enabled}
            onChange={(v) => update({ enabled: v })}
            disabled={isLoading || isError || mutation.isPending}
          />
        }
      />
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-2">
          {form.enabled
            ? 'Клиентам начисляются бонусы за покупки, которыми можно частично оплатить новый заказ.'
            : 'Программа выключена. Начисление бонусов остановлено, накопленный баланс остаётся доступным для списания.'}
        </p>

        {/* Проценты и «Сохранить» — только после успешной загрузки: при ошибке
            нельзя показывать редактируемые 0/0, которыми можно затереть настройку. */}
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          minHeight="py-4"
          errorTitle="Не удалось загрузить программу лояльности"
          errorDescription="Проценты скрыты, чтобы не перезаписать сохранённые настройки. Повторите загрузку."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Начисление с покупки"
              htmlFor={`${idBase}-accrual`}
              hint="Процент от суммы чека, который зачисляется бонусами."
            >
              <Input
                id={`${idBase}-accrual`}
                value={String(form.accrualPercent)}
                onChange={(e) => update({ accrualPercent: clampPercent(e.target.value) })}
                inputMode="numeric"
                placeholder="0"
                className="tabular-nums"
                rightSlot={percentSlot}
              />
            </Field>
            <Field
              label="Макс. оплата бонусами"
              htmlFor={`${idBase}-redeem`}
              hint="Какую долю чека можно погасить бонусами."
            >
              <Input
                id={`${idBase}-redeem`}
                value={String(form.redeemMaxPercent)}
                onChange={(e) => update({ redeemMaxPercent: clampPercent(e.target.value) })}
                inputMode="numeric"
                placeholder="0"
                className="tabular-nums"
                rightSlot={percentSlot}
              />
            </Field>
          </div>
        </QueryState>
      </CardBody>
      {dirty && (
        <CardFooter>
          <span className="text-xs text-ink-3">Изменения не сохранены</span>
          <Button onClick={handleSave} loading={mutation.isPending}>
            Сохранить программу
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Реквизиты компании (company_manage) — одна форма, одна кнопка сохранения в
// липкой полосе снизу (аудит 2.8: кнопка появлялась только под четырьмя
// карточками и на 1280×800 оставалась за фолдом).
// ---------------------------------------------------------------------------
function CompanyDetailsTab() {
  const queryClient = useQueryClient();
  const idBase = useId();

  const {
    data: company,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
  });

  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty);

  // 156 — тумблер «Общая база клиентов» виден только когда есть что разделять
  // (живых точек больше одной). Общий хук = тот же слот ['points'], что у
  // индикатора филиала в шапке, — лишнего запроса нет.
  const { data: pointsData } = usePointsQuery();
  const pointsCount = pointsData?.points.length ?? 0;

  useEffect(() => {
    if (company) {
      setForm(formFromCompany(company));
      setDirty(false);
    }
  }, [company]);

  const mutation = useMutation({
    mutationFn: (data: Partial<Tenant>) => myCompanyApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-company'] });
      toast.success('Настройки сохранены');
      setDirty(false);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const update = (patch: Partial<CompanyForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const discard = () => {
    if (company) setForm(formFromCompany(company));
    setDirty(false);
  };

  const handleSave = () => {
    mutation.mutate({
      name: form.name || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      legalName: form.legalName || undefined,
      inn: form.inn || undefined,
      kpp: form.kpp || undefined,
      ogrn: form.ogrn || undefined,
      receiptFooter: form.receiptFooter || undefined,
      // 157 — пояс отправляем всегда: это значение поля, а не тумблер, и
      // сервер принимает только id из белого списка.
      timezone: form.timezone || DEFAULT_TIMEZONE,
      // 156 — булев тумблер шлём ЦЕЛИКОМ (включая false), иначе выключить
      // общую базу было бы невозможно: undefined бэкенд игнорирует. И только
      // когда есть что разделять — у одноточечного тенанта поле не трогаем.
      ...(pointsCount > 1 ? { pointsSharedClients: form.pointsSharedClients } : null),
    });
  };

  const tzOptions = useMemo(
    () => RU_TIMEZONES.map((z) => ({ value: z.id, label: `${z.label} · ${z.utc} — ${z.hint}` })),
    [],
  );

  return (
    // Форма редактируется только после успешной загрузки: при ошибке поля были
    // бы пустыми, и «Сохранить» затёр бы настоящие реквизиты.
    <QueryState
      isLoading={isLoading}
      isError={isError}
      onRetry={refetch}
      isFetching={isFetching}
      loader={
        <div className="space-y-5">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={3} />
        </div>
      }
      minHeight="min-h-[40vh]"
      errorTitle="Не удалось загрузить настройки компании"
      errorDescription="Форма скрыта, чтобы не перезаписать сохранённые реквизиты. Повторите загрузку."
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !mutation.isPending) handleSave();
        }}
      >
        <Card padding="none">
          <CardHeader icon={Building2} title="Основные данные" subtitle="Название и контакты автосервиса" />
          <CardBody className="space-y-4">
            <Field label="Название компании" htmlFor={`${idBase}-name`}>
              <Input
                id={`${idBase}-name`}
                name="organization"
                autoComplete="organization"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Автосервис «Мастер»"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Телефон" htmlFor={`${idBase}-phone`}>
                <Input
                  id={`${idBase}-phone`}
                  type="tel"
                  name="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => update({ phone: e.target.value })}
                  placeholder="+7 (999) 123-45-67"
                />
              </Field>
              <Field label="Email" htmlFor={`${idBase}-email`}>
                <Input
                  id={`${idBase}-email`}
                  type="email"
                  name="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={form.email}
                  onChange={(e) => update({ email: e.target.value })}
                  placeholder="info@autoservice.ru"
                />
              </Field>
            </div>

            <Field label="Адрес" htmlFor={`${idBase}-address`}>
              <Input
                id={`${idBase}-address`}
                name="street-address"
                autoComplete="street-address"
                value={form.address}
                onChange={(e) => update({ address: e.target.value })}
                placeholder="г. Москва, ул. Примерная, д. 1"
              />
            </Field>

            {/* 157 — часовой пояс автосервиса: список фиксированный, сервер
                принимает только эти id. */}
            <Field
              label="Часовой пояс"
              htmlFor={`${idBase}-tz`}
              hint={`От пояса зависит, что считается «сегодня»: выручка за день, смены и отчёты. Сейчас в этом поясе: ${formatDateTime(
                new Date().toISOString(),
                timezoneOption(form.timezone).id,
              )}`}
            >
              <Select
                id={`${idBase}-tz`}
                value={form.timezone}
                onChange={(e) => update({ timezone: e.target.value })}
                options={tzOptions}
              />
            </Field>

            <Field label="Описание" htmlFor={`${idBase}-description`}>
              <Textarea
                id={`${idBase}-description`}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                rows={2}
                placeholder="Краткое описание вашего автосервиса"
              />
            </Field>
          </CardBody>
        </Card>

        <Card padding="none">
          <CardHeader icon={Receipt} title="Реквизиты для чеков" subtitle="Печатаются в заказ-наряде и чеке" />
          <CardBody className="space-y-4">
            <Field label="Юридическое название" htmlFor={`${idBase}-legal`}>
              <Input
                id={`${idBase}-legal`}
                value={form.legalName}
                onChange={(e) => update({ legalName: e.target.value })}
                placeholder="ИП Иванов И.И. или ООО «Мастер»"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="ИНН" htmlFor={`${idBase}-inn`}>
                <Input
                  id={`${idBase}-inn`}
                  value={form.inn}
                  onChange={(e) => update({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                  placeholder="1234567890"
                  inputMode="numeric"
                  className="tabular-nums"
                />
              </Field>
              <Field label="КПП" htmlFor={`${idBase}-kpp`}>
                <Input
                  id={`${idBase}-kpp`}
                  value={form.kpp}
                  onChange={(e) => update({ kpp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                  placeholder="123456789"
                  inputMode="numeric"
                  className="tabular-nums"
                />
              </Field>
              <Field label="ОГРН" htmlFor={`${idBase}-ogrn`}>
                <Input
                  id={`${idBase}-ogrn`}
                  value={form.ogrn}
                  onChange={(e) => update({ ogrn: e.target.value.replace(/\D/g, '').slice(0, 15) })}
                  placeholder="1234567890123"
                  inputMode="numeric"
                  className="tabular-nums"
                />
              </Field>
            </div>

            <Field label="Текст внизу чека" htmlFor={`${idBase}-footer`} hint="Печатается внизу каждого чека.">
              <Textarea
                id={`${idBase}-footer`}
                value={form.receiptFooter}
                onChange={(e) => update({ receiptFooter: e.target.value })}
                rows={2}
                placeholder="Спасибо за визит! Ждём вас снова!"
              />
            </Field>
          </CardBody>
        </Card>

        {/* 156 — мульти-точки: общая или раздельная база клиентов. Карточка
            видна только при >1 живой точке (0–1 = одноточечный режим,
            ничего нового не показываем) и под тем же company_manage, что и
            остальные реквизиты. Зеркало мобильных настроек компании. */}
        {pointsCount > 1 && (
          <Card padding="none">
            <CardHeader icon={Building2} title="Филиалы" subtitle="Как филиалы делят клиентскую базу" />
            <CardBody>
              <ToggleRow
                label="Общая база клиентов всех филиалов"
                description="Выключено — у каждого филиала свой список клиентов."
                checked={form.pointsSharedClients}
                onChange={(v) => update({ pointsSharedClients: v })}
              />
            </CardBody>
          </Card>
        )}

        <StickySaveBar
          visible={dirty}
          saving={mutation.isPending}
          onSave={handleSave}
          onDiscard={discard}
          saveLabel="Сохранить настройки"
        />
      </form>
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------
export default function CompanySettingsPage() {
  const { hasPermission } = useAuth();
  // Реквизиты компании (/my-company) и VIN — owner-only ключ company_manage (у
  // системного «Администратора» сид false — как прежний @Roles d/sa). Секции
  // «Кассовая смена» и «Лояльность» — settings_manage и self-gate'ятся сами.
  const canManageCompany = hasPermission('company_manage');
  const canManageSettings = hasPermission('settings_manage');
  const [params, setParams] = useSearchParams();

  const tabs = useMemo<TabItem<SettingsTab>[]>(() => {
    const items: TabItem<SettingsTab>[] = [];
    if (canManageCompany) {
      items.push({ key: 'company', label: 'Реквизиты', icon: Building2 });
      items.push({ key: 'cars', label: 'Автомобили', icon: Car });
    }
    if (canManageSettings) {
      items.push({ key: 'cash', label: 'Касса', icon: Wallet });
      items.push({ key: 'loyalty', label: 'Лояльность', icon: Gift });
    }
    return items;
  }, [canManageCompany, canManageSettings]);

  const requested = params.get('tab') as SettingsTab | null;
  const tab: SettingsTab | null = tabs.some((t) => t.key === requested) ? requested : (tabs[0]?.key ?? null);

  const setTab = (next: SettingsTab) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Настройки компании"
        icon={Settings}
        subtitle={
          canManageCompany
            ? 'Реквизиты, автомобили, кассовая смена и программа лояльности'
            : 'Кассовая смена и программа лояльности'
        }
      />

      {tabs.length === 0 || !tab ? (
        <Card padding="md">
          <p className="text-sm text-ink-2">
            Настройки компании доступны владельцу и сотрудникам с правом «Управляет настройками».
          </p>
        </Card>
      ) : (
        <>
          <Tabs items={tabs} value={tab} onChange={setTab} aria-label="Разделы настроек" idPrefix="company-settings" />

          <div className="max-w-3xl">
            <TabPanel idPrefix="company-settings" tabKey="company" active={tab === 'company'}>
              <CompanyDetailsTab />
            </TabPanel>
            <TabPanel idPrefix="company-settings" tabKey="cars" active={tab === 'cars'}>
              <VinSettingsCard />
            </TabPanel>
            <TabPanel idPrefix="company-settings" tabKey="cash" active={tab === 'cash'}>
              <ShiftModeSection />
            </TabPanel>
            <TabPanel idPrefix="company-settings" tabKey="loyalty" active={tab === 'loyalty'}>
              <LoyaltySettingsSection />
            </TabPanel>
          </div>
        </>
      )}
    </div>
  );
}
