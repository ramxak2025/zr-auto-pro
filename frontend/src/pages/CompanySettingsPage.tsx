import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Phone,
  MapPin,
  Mail,
  FileText,
  Save,
  Loader2,
  Receipt,
  Gift,
  Percent,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { myCompanyApi, loyaltyApi, checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Switch from '../components/Switch';
import QueryState from '../components/QueryState';

import type { Tenant, LoyaltySettings, PosSettings } from '../types';

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
}

// ---- POS «Кассовая смена + роли» ----
// Single permission-gated switch. GET /checks/pos-settings is readable by
// anyone, PATCH requires settings_manage (волна Битрикс24). One boolean →
// mutate on toggle (no separate Save step). The server enforces the cashier
// rules; this switch just turns the regime on/off tenant-wide.
function ShiftModeSection() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings_manage');

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

  const mutation = useMutation({
    mutationFn: (shiftModeEnabled: boolean) => checksApi.updatePosSettings({ shiftModeEnabled }),
    onSuccess: (_res, shiftModeEnabled) => {
      queryClient.setQueryData<PosSettings>(['checks', 'pos-settings'], (prev) =>
        prev ? { ...prev, shiftModeEnabled } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['checks', 'pos-settings'] });
      toast.success(shiftModeEnabled ? 'Режим кассовой смены включён' : 'Режим кассовой смены выключен');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  if (!canManage) return null;

  const enabled = settings?.shiftModeEnabled ?? false;

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Режим кассовой смены</h2>
        </div>
        <Switch
          label="Режим кассовой смены"
          checked={enabled}
          onChange={(v) => mutation.mutate(v)}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      {isError ? (
        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
          <span>Не удалось загрузить состояние режима.</span>
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary btn-sm press-soft">
            Повторить
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {enabled
              ? 'Оплату по заказ-наряду проводят только кассиры — сотрудники с правом «Приём оплаты». Мастер без этого права создаёт отложенный заказ-наряд без оплаты, а цена товара фиксируется по складу.'
              : 'Выключено. Оплату по заказ-наряду может проводить любой сотрудник с доступом к кассе.'}
          </p>
          <p className="text-[11px] text-gray-500">
            Право «Приём оплаты (кассир)» назначается сотруднику в разделе «Сотрудники».
          </p>
        </>
      )}
    </div>
  );
}

// ---- Loyalty program settings (settings_manage) ----
function LoyaltySettingsSection() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Backend PATCH /loyalty/settings → settings_manage (волна Битрикс24).
  const canManage = hasPermission('settings_manage');

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
    onError: () => toast.error('Ошибка сохранения'),
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

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Программа лояльности</h2>
        </div>
        <Switch
          label="Программа лояльности"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      <p className="text-xs text-gray-500 -mt-1">
        {form.enabled
          ? 'Клиентам начисляются бонусы за покупки, которыми можно частично оплатить новый заказ.'
          : 'Программа выключена. Начисление бонусов остановлено, накопленный баланс остаётся доступным для списания.'}
      </p>

      {/* Gate the percent fields + Save behind a successful load — a failed
          fetch must not expose editable 0/0 defaults that could Save over the
          real accrual/redeem config. */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="py-4"
        errorTitle="Не удалось загрузить программу лояльности"
        errorDescription="Проценты скрыты, чтобы не перезаписать сохранённые настройки. Повторите загрузку."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">
              <Percent className="h-3 w-3 inline mr-1" />
              Начисление с покупки
            </label>
            <div className="relative">
              <input
                value={String(form.accrualPercent)}
                onChange={(e) => update({ accrualPercent: clampPercent(e.target.value) })}
                className="input pr-9 tabular-nums"
                inputMode="numeric"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Процент от суммы чека, который зачисляется бонусами.</p>
          </div>
          <div>
            <label className="label">
              <Percent className="h-3 w-3 inline mr-1" />
              Макс. оплата бонусами
            </label>
            <div className="relative">
              <input
                value={String(form.redeemMaxPercent)}
                onChange={(e) => update({ redeemMaxPercent: clampPercent(e.target.value) })}
                className="input pr-9 tabular-nums"
                inputMode="numeric"
                placeholder="0"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Какую долю чека можно погасить бонусами.</p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить программу
          </button>
        )}
      </QueryState>
    </div>
  );
}

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Реквизиты компании (/my-company) — owner-only ключ company_manage (у
  // системного «Администратора» сид false — как прежний @Roles d/sa). Секции
  // «Кассовая смена» и «Лояльность» — settings_manage и self-gate'ятся сами.
  const canManageCompany = hasPermission('company_manage');

  const {
    data: company,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: canManageCompany,
  });

  const [form, setForm] = useState<CompanyForm>({
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
  });

  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (company) {
      setForm({
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
      });
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
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<CompanyForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
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
    });
  };

  // Без company_manage реквизиты компании скрыты (сервер отвечает 403 на
  // GET/PATCH /my-company), но секции на settings_manage остаются доступны.
  if (!canManageCompany) {
    return (
      <div className="space-y-5 max-w-2xl mx-auto pb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-ghost btn-sm" aria-label="Назад">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="page-title">Настройки компании</h1>
            <p className="text-sm text-gray-500">Кассовая смена и программа лояльности</p>
          </div>
        </div>
        <ShiftModeSection />
        <LoyaltySettingsSection />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-sm" aria-label="Назад">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title">Настройки компании</h1>
          <p className="text-sm text-gray-500">Реквизиты и данные для чеков</p>
        </div>
      </div>

      {/* Gate the entire editable form behind a successful load — on fetch
          failure the fields would render empty and a Save would overwrite the
          real company/receipt data. */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="min-h-[40vh]"
        errorTitle="Не удалось загрузить настройки компании"
        errorDescription="Форма скрыта, чтобы не перезаписать сохранённые реквизиты. Повторите загрузку."
      >
        <div className="space-y-5">
          {/* Company info */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Основные данные</h2>
            </div>

            <div>
              <label className="label">Название компании</label>
              <input
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                className="input"
                placeholder="Автосервис «Мастер»"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">
                  <Phone className="h-3 w-3 inline mr-1" />
                  Телефон
                </label>
                <input
                  value={form.phone}
                  onChange={(e) => update({ phone: e.target.value })}
                  className="input"
                  placeholder="+7 (999) 123-45-67"
                />
              </div>
              <div>
                <label className="label">
                  <Mail className="h-3 w-3 inline mr-1" />
                  Email
                </label>
                <input
                  value={form.email}
                  onChange={(e) => update({ email: e.target.value })}
                  className="input"
                  placeholder="info@autoservice.ru"
                />
              </div>
            </div>

            <div>
              <label className="label">
                <MapPin className="h-3 w-3 inline mr-1" />
                Адрес
              </label>
              <input
                value={form.address}
                onChange={(e) => update({ address: e.target.value })}
                className="input"
                placeholder="г. Москва, ул. Примерная, д. 1"
              />
            </div>

            <div>
              <label className="label">Описание</label>
              <textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                rows={2}
                className="input resize-none"
                placeholder="Краткое описание вашего автосервиса"
              />
            </div>
          </div>

          {/* Receipt / legal details */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Реквизиты для чеков</h2>
            </div>

            <div>
              <label className="label">Юридическое название</label>
              <input
                value={form.legalName}
                onChange={(e) => update({ legalName: e.target.value })}
                className="input"
                placeholder="ИП Иванов И.И. или ООО «Мастер»"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">ИНН</label>
                <input
                  value={form.inn}
                  onChange={(e) => update({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                  className="input"
                  placeholder="1234567890"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="label">КПП</label>
                <input
                  value={form.kpp}
                  onChange={(e) => update({ kpp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                  className="input"
                  placeholder="123456789"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="label">ОГРН</label>
                <input
                  value={form.ogrn}
                  onChange={(e) => update({ ogrn: e.target.value.replace(/\D/g, '').slice(0, 15) })}
                  className="input"
                  placeholder="1234567890123"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div>
              <label className="label">
                <FileText className="h-3 w-3 inline mr-1" />
                Текст внизу чека
              </label>
              <textarea
                value={form.receiptFooter}
                onChange={(e) => update({ receiptFooter: e.target.value })}
                rows={2}
                className="input resize-none"
                placeholder="Спасибо за визит! Ждём вас снова!"
              />
              <p className="text-xs text-gray-500 mt-1">Этот текст будет печататься внизу каждого чека</p>
            </div>
          </div>

          {/* Cash-shift mode + cashier roles (owner-class) */}
          <ShiftModeSection />

          {/* Loyalty program (owner-class) */}
          <LoyaltySettingsSection />

          {/* Save */}
          {dirty && (
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3.5 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить настройки
            </button>
          )}
        </div>
      </QueryState>
    </div>
  );
}
