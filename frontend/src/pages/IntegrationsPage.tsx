import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CreditCard,
  Receipt,
  Save,
  Loader2,
  KeyRound,
  Info,
  PhoneCall,
  Copy,
  Check,
  Link2,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { paymentsApi, fiscalApi, telephonyApi, walletApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Switch from '../components/Switch';
import QueryState from '../components/QueryState';
import { UserRole } from '../types';
import type {
  PaymentIntegrationSettings,
  FiscalSettings,
  PaymentProviderName,
  FiscalSno,
  FiscalVat,
  TelephonySettings,
  WalletSettings,
} from '../types';

// Shared field styles (match CompanySettingsPage rhythm)
const inputCls =
  'w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-400';
const textareaCls = `${inputCls} font-mono text-xs leading-relaxed min-h-[88px] resize-y`;
const labelCls = 'text-xs font-medium text-gray-600 mb-1 block';
const hintCls = 'text-[11px] text-gray-500 mt-1';

function StoredBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
      {label}
    </span>
  );
}

// Accessible toggle wrapper — `label` gives the switch an accessible name
// (the old sr-only checkbox announced as an unnamed "checkbox").
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />;
}

const HINT = 'Ключи — в ЛК провайдера; до ввода функция неактивна.';

// ──────────────────────────────────────────────────────────────────────────
//  Эквайринг (карта / СБП)
// ──────────────────────────────────────────────────────────────────────────

const PAYMENT_PROVIDERS: { value: PaymentProviderName; label: string }[] = [
  { value: 'yookassa', label: 'ЮKassa' },
  { value: 'tinkoff', label: 'Тинькофф' },
];

function AcquiringCard() {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<PaymentIntegrationSettings>({
    queryKey: ['payments', 'settings'],
    queryFn: async () => (await paymentsApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    provider: PaymentProviderName;
    enabled: boolean;
    shopId: string;
    secretKey: string;
  }>({ provider: 'yookassa', enabled: false, shopId: '', secretKey: '' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        provider: settings.provider,
        enabled: settings.enabled,
        shopId: settings.shopId ?? '',
        secretKey: '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { provider?: PaymentProviderName; enabled?: boolean; shopId?: string; secretKey?: string }) =>
      paymentsApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['payments', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['payments', 'settings'] });
      toast.success('Эквайринг сохранён');
      setDirty(false);
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: { provider?: PaymentProviderName; enabled?: boolean; shopId?: string; secretKey?: string } = {
      provider: form.provider,
      enabled: form.enabled,
      shopId: form.shopId.trim(),
    };
    // Only send the secret when the user actually typed a new one — an empty
    // field means "keep the stored key" (the input only ever shows a mask).
    const secret = form.secretKey.trim();
    if (secret) payload.secretKey = secret;
    mutation.mutate(payload);
  };

  const keyPlaceholder =
    settings?.hasSecretKey && settings.secretKeyMask
      ? `${settings.secretKeyMask} — введите, чтобы заменить`
      : 'Секретный ключ магазина';

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Эквайринг (карта / СБП)</h2>
        </div>
        <Toggle
          label="Эквайринг"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500 -mt-1">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{HINT}</span>
      </p>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="py-6"
        errorTitle="Не удалось загрузить настройки"
        errorDescription="Форма скрыта, чтобы не перезаписать сохранённые ключи. Повторите загрузку."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Провайдер</label>
              <select
                value={form.provider}
                onChange={(e) => update({ provider: e.target.value as PaymentProviderName })}
                className={inputCls}
              >
                {PAYMENT_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Shop ID</label>
              <input
                value={form.shopId}
                onChange={(e) => update({ shopId: e.target.value })}
                className={inputCls}
                placeholder="123456"
                inputMode="numeric"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>
              <KeyRound className="h-3 w-3 inline mr-1" />
              Секретный ключ
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.secretKey}
              onChange={(e) => update({ secretKey: e.target.value })}
              className={inputCls}
              placeholder={keyPlaceholder}
            />
            <p className={hintCls}>
              {settings?.hasSecretKey
                ? 'Ключ сохранён. Оставьте поле пустым, чтобы не менять его.'
                : 'Ключ ещё не задан — эквайринг неактивен, пока он не введён.'}
            </p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить эквайринг
          </button>
        )}
      </QueryState>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Онлайн-касса 54-ФЗ (АТОЛ)
// ──────────────────────────────────────────────────────────────────────────

const SNO_OPTIONS: { value: FiscalSno; label: string }[] = [
  { value: 'osn', label: 'ОСН — общая' },
  { value: 'usn_income', label: 'УСН — доходы' },
  { value: 'usn_income_outcome', label: 'УСН — доходы минус расходы' },
  { value: 'envd', label: 'ЕНВД' },
  { value: 'esn', label: 'ЕСХН' },
  { value: 'patent', label: 'Патент' },
];

const VAT_OPTIONS: { value: FiscalVat; label: string }[] = [
  { value: 'none', label: 'Без НДС' },
  { value: 'vat0', label: 'НДС 0%' },
  { value: 'vat10', label: 'НДС 10%' },
  { value: 'vat20', label: 'НДС 20%' },
  { value: 'vat110', label: 'НДС 10/110' },
  { value: 'vat120', label: 'НДС 20/120' },
];

function FiscalCard() {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<FiscalSettings>({
    queryKey: ['fiscal', 'settings'],
    queryFn: async () => (await fiscalApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    enabled: boolean;
    login: string;
    password: string;
    groupCode: string;
    sno: FiscalSno | '';
    inn: string;
    paymentAddress: string;
    companyEmail: string;
    vat: FiscalVat | '';
  }>({
    enabled: false,
    login: '',
    password: '',
    groupCode: '',
    sno: '',
    inn: '',
    paymentAddress: '',
    companyEmail: '',
    vat: '',
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled,
        login: settings.login ?? '',
        password: '',
        groupCode: settings.groupCode ?? '',
        sno: settings.sno ?? '',
        inn: settings.inn ?? '',
        paymentAddress: settings.paymentAddress ?? '',
        companyEmail: settings.companyEmail ?? '',
        vat: (settings.vat as FiscalVat) || '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled?: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    }) => fiscalApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['fiscal', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['fiscal', 'settings'] });
      toast.success('Онлайн-касса сохранена');
      setDirty(false);
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: {
      enabled?: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    } = {
      enabled: form.enabled,
      login: form.login.trim(),
      groupCode: form.groupCode.trim(),
      inn: form.inn.trim(),
      paymentAddress: form.paymentAddress.trim(),
      companyEmail: form.companyEmail.trim(),
    };
    // Send the password only when re-entered — empty keeps the stored secret.
    const pwd = form.password.trim();
    if (pwd) payload.password = pwd;
    if (form.sno) payload.sno = form.sno;
    if (form.vat) payload.vat = form.vat;
    mutation.mutate(payload);
  };

  const pwdPlaceholder =
    settings?.hasPassword && settings.passwordMask
      ? `${settings.passwordMask} — введите, чтобы заменить`
      : 'Пароль АТОЛ';

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Онлайн-касса 54-ФЗ (АТОЛ)</h2>
        </div>
        <Toggle
          label="Онлайн-касса 54-ФЗ"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500 -mt-1">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{HINT}</span>
      </p>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="py-6"
        errorTitle="Не удалось загрузить настройки"
        errorDescription="Форма скрыта, чтобы не перезаписать сохранённые данные. Повторите загрузку."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Логин</label>
              <input
                value={form.login}
                onChange={(e) => update({ login: e.target.value })}
                className={inputCls}
                placeholder="Логин АТОЛ"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls}>
                <KeyRound className="h-3 w-3 inline mr-1" />
                Пароль
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update({ password: e.target.value })}
                className={inputCls}
                placeholder={pwdPlaceholder}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Код группы</label>
              <input
                value={form.groupCode}
                onChange={(e) => update({ groupCode: e.target.value })}
                className={inputCls}
                placeholder="group_code ККТ"
              />
            </div>
            <div>
              <label className={labelCls}>СНО</label>
              <select
                value={form.sno}
                onChange={(e) => update({ sno: e.target.value as FiscalSno | '' })}
                className={inputCls}
              >
                <option value="">Не выбрана</option>
                {SNO_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ИНН</label>
              <input
                value={form.inn}
                onChange={(e) => update({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                className={inputCls}
                placeholder="1234567890"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className={labelCls}>НДС</label>
              <select
                value={form.vat}
                onChange={(e) => update({ vat: e.target.value as FiscalVat | '' })}
                className={inputCls}
              >
                <option value="">Не выбран</option>
                {VAT_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Адрес расчётов</label>
            <input
              value={form.paymentAddress}
              onChange={(e) => update({ paymentAddress: e.target.value })}
              className={inputCls}
              placeholder="г. Москва, ул. Примерная, д. 1"
            />
          </div>

          <div>
            <label className={labelCls}>Email компании</label>
            <input
              type="email"
              value={form.companyEmail}
              onChange={(e) => update({ companyEmail: e.target.value })}
              className={inputCls}
              placeholder="info@autoservice.ru"
            />
            <p className={hintCls}>На этот адрес ОФД отправит электронный чек, если у клиента нет почты.</p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить онлайн-кассу
          </button>
        )}
      </QueryState>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Телефония (Mango Office)
// ──────────────────────────────────────────────────────────────────────────

const MANGO_HINT = 'Ключи — в ЛК Mango; до ввода телефония неактивна.';

/**
 * The public origin Mango must POST its call-event callbacks to. The webhook
 * route itself is server-only (signature-verified) — here we only *display* the
 * URL for the owner to paste into the Mango VPBX panel. Mirrors how axios
 * resolves its baseURL: an absolute VITE_API_URL → its origin; a relative
 * '/api' → the current page origin.
 */
function apiOrigin(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  try {
    return new URL(base).origin;
  } catch {
    return window.location.origin;
  }
}

function TelephonyCard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<TelephonySettings>({
    queryKey: ['telephony', 'settings'],
    queryFn: async () => (await telephonyApi.getSettings()).data,
  });

  const [form, setForm] = useState<{ enabled: boolean; apiKey: string; apiSalt: string }>({
    enabled: false,
    apiKey: '',
    apiSalt: '',
  });
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settings) {
      // Secrets are write-only — the inputs always start empty and only show a mask.
      setForm({ enabled: settings.enabled, apiKey: '', apiSalt: '' });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { provider?: 'mango'; enabled?: boolean; apiKey?: string; apiSalt?: string }) =>
      telephonyApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['telephony', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['telephony', 'settings'] });
      toast.success('Телефония сохранена');
      setDirty(false);
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: { provider?: 'mango'; enabled?: boolean; apiKey?: string; apiSalt?: string } = {
      provider: 'mango',
      enabled: form.enabled,
    };
    // Send secrets only when re-entered — an empty field keeps the stored value.
    const key = form.apiKey.trim();
    if (key) payload.apiKey = key;
    const salt = form.apiSalt.trim();
    if (salt) payload.apiSalt = salt;
    mutation.mutate(payload);
  };

  const keyPlaceholder =
    settings?.hasApiKey && settings.apiKeyMask
      ? `${settings.apiKeyMask} — введите, чтобы заменить`
      : 'API key (vpbx) из ЛК Mango';
  const saltPlaceholder =
    settings?.hasApiSalt && settings.apiSaltMask
      ? `${settings.apiSaltMask} — введите, чтобы заменить`
      : 'Соль для подписи (sign salt)';

  const webhookUrl = tenantId ? `${apiOrigin()}/api/telephony/webhook/${tenantId}` : '';

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Телефония (Mango Office)</h2>
        </div>
        <Toggle
          label="Телефония"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500 -mt-1">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{MANGO_HINT}</span>
      </p>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="py-6"
        errorTitle="Не удалось загрузить настройки"
        errorDescription="Форма скрыта, чтобы не перезаписать сохранённые ключи. Повторите загрузку."
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                <KeyRound className="h-3 w-3 inline mr-1" />
                API key (vpbx)
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                className={inputCls}
                placeholder={keyPlaceholder}
              />
            </div>
            <div>
              <label className={labelCls}>
                <KeyRound className="h-3 w-3 inline mr-1" />
                Соль для подписи
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.apiSalt}
                onChange={(e) => update({ apiSalt: e.target.value })}
                className={inputCls}
                placeholder={saltPlaceholder}
              />
            </div>
          </div>

          <p className={hintCls}>
            {settings?.hasApiKey && settings?.hasApiSalt
              ? 'Ключи сохранены. Оставьте поля пустыми, чтобы не менять их.'
              : 'Ключи ещё не заданы — телефония неактивна, пока они не введены.'}
          </p>

          <div>
            <label className={labelCls}>
              <Link2 className="h-3 w-3 inline mr-1" />
              Webhook для Mango VPBX
            </label>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={webhookUrl || 'Tenant не определён — обратитесь к администратору'}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputCls} font-mono text-xs bg-gray-50 cursor-text`}
              />
              <button
                type="button"
                onClick={copyWebhook}
                disabled={!webhookUrl}
                className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                title="Скопировать ссылку"
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className={hintCls}>
              Вставьте этот адрес в настройки событий Mango VPBX (входящий / пропущенный звонок), чтобы звонки попадали
              в раздел «Звонки» и приходили уведомления.
            </p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить телефонию
          </button>
        )}
      </QueryState>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Apple Wallet (карта лояльности)
// ──────────────────────────────────────────────────────────────────────────

const WALLET_HINT = 'Сертификат Apple Pass Type ID — из Apple Developer. До загрузки карта недоступна.';

function WalletCard() {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<WalletSettings>({
    queryKey: ['wallet', 'settings'],
    queryFn: async () => (await walletApi.getSettings()).data,
  });

  const [form, setForm] = useState<{
    enabled: boolean;
    passTypeId: string;
    teamId: string;
    organizationName: string;
    logoUrl: string;
    bgColor: string;
    certPem: string;
    certKeyPem: string;
    certKeyPassword: string;
    wwdrPem: string;
  }>({
    enabled: false,
    passTypeId: '',
    teamId: '',
    organizationName: '',
    logoUrl: '',
    bgColor: '',
    certPem: '',
    certKeyPem: '',
    certKeyPassword: '',
    wwdrPem: '',
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      // Cert material is write-only — those fields always start empty and the
      // form only ever shows a "stored" flag, never the real PEM/password.
      setForm({
        enabled: settings.enabled,
        passTypeId: settings.passTypeId ?? '',
        teamId: settings.teamId ?? '',
        organizationName: settings.organizationName ?? '',
        logoUrl: settings.logoUrl ?? '',
        bgColor: settings.bgColor ?? '',
        certPem: '',
        certKeyPem: '',
        certKeyPassword: '',
        wwdrPem: '',
      });
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled?: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    }) => walletApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['wallet', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['wallet', 'settings'] });
      toast.success('Apple Wallet сохранён');
      setDirty(false);
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    const payload: {
      enabled?: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    } = {
      enabled: form.enabled,
      passTypeId: form.passTypeId.trim(),
      teamId: form.teamId.trim(),
      organizationName: form.organizationName.trim(),
      logoUrl: form.logoUrl.trim(),
      bgColor: form.bgColor.trim(),
    };
    // Cert material is sent only when (re)entered — an empty field keeps the
    // stored secret untouched (the form shows a flag, not the real value).
    const cert = form.certPem.trim();
    if (cert) payload.certPem = cert;
    const certKey = form.certKeyPem.trim();
    if (certKey) payload.certKeyPem = certKey;
    const certPwd = form.certKeyPassword.trim();
    if (certPwd) payload.certKeyPassword = certPwd;
    const wwdr = form.wwdrPem.trim();
    if (wwdr) payload.wwdrPem = wwdr;
    mutation.mutate(payload);
  };

  const certPlaceholder = settings?.hasCert
    ? 'Сертификат загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN CERTIFICATE-----';
  const certKeyPlaceholder = settings?.hasCertKey
    ? 'Ключ загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN PRIVATE KEY-----';
  const certPwdPlaceholder = settings?.hasCertKeyPassword
    ? '•••••• загружен — введите, чтобы заменить'
    : 'Пароль приватного ключа (если задан)';
  const wwdrPlaceholder = settings?.hasWwdr
    ? 'Сертификат WWDR загружен — вставьте новый PEM, чтобы заменить'
    : '-----BEGIN CERTIFICATE-----';

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Apple Wallet (карта лояльности)</h2>
        </div>
        <Toggle
          label="Apple Wallet"
          checked={form.enabled}
          onChange={(v) => update({ enabled: v })}
          disabled={isLoading || isError || mutation.isPending}
        />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500 -mt-1">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{WALLET_HINT}</span>
      </p>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        minHeight="py-6"
        errorTitle="Не удалось загрузить настройки"
        errorDescription="Форма скрыта, чтобы не перезаписать сохранённые сертификаты. Повторите загрузку."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <StoredBadge ok={!!settings?.hasCert} label="Сертификат" />
            <StoredBadge ok={!!settings?.hasCertKey} label="Ключ" />
            <StoredBadge ok={!!settings?.hasWwdr} label="WWDR" />
            <StoredBadge
              ok={!!settings?.configured}
              label={settings?.configured ? 'Готово к выдаче' : 'Не настроено'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Pass Type ID</label>
              <input
                value={form.passTypeId}
                onChange={(e) => update({ passTypeId: e.target.value })}
                className={inputCls}
                placeholder="pass.com.autexa.loyalty"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls}>Team ID</label>
              <input
                value={form.teamId}
                onChange={(e) => update({ teamId: e.target.value })}
                className={inputCls}
                placeholder="98SHYK65HQ"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Название организации</label>
            <input
              value={form.organizationName}
              onChange={(e) => update({ organizationName: e.target.value })}
              className={inputCls}
              placeholder="Название автосервиса на карте"
            />
            <p className={hintCls}>Печатается на карте. Если оставить пустым — подставится название компании.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Логотип (URL)</label>
              <input
                value={form.logoUrl}
                onChange={(e) => update({ logoUrl: e.target.value })}
                className={inputCls}
                placeholder="https://…/logo.png"
                inputMode="url"
              />
            </div>
            <div>
              <label className={labelCls}>Цвет фона</label>
              <div className="flex items-stretch gap-2">
                <input
                  value={form.bgColor}
                  onChange={(e) => update({ bgColor: e.target.value })}
                  className={inputCls}
                  placeholder="#1E88E5"
                />
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.bgColor) ? form.bgColor : '#1E88E5'}
                  onChange={(e) => update({ bgColor: e.target.value })}
                  className="h-[42px] w-12 flex-shrink-0 cursor-pointer rounded-xl border border-gray-200 bg-white p-1"
                  title="Выбрать цвет"
                  aria-label="Выбрать цвет фона"
                />
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>
              <KeyRound className="h-3 w-3 inline mr-1" />
              Certificate PEM
            </label>
            <textarea
              value={form.certPem}
              onChange={(e) => update({ certPem: e.target.value })}
              className={textareaCls}
              placeholder={certPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className={labelCls}>
              <KeyRound className="h-3 w-3 inline mr-1" />
              Certificate key PEM
            </label>
            <textarea
              value={form.certKeyPem}
              onChange={(e) => update({ certKeyPem: e.target.value })}
              className={textareaCls}
              placeholder={certKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className={labelCls}>
              <KeyRound className="h-3 w-3 inline mr-1" />
              Пароль ключа
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.certKeyPassword}
              onChange={(e) => update({ certKeyPassword: e.target.value })}
              className={inputCls}
              placeholder={certPwdPlaceholder}
            />
          </div>

          <div>
            <label className={labelCls}>
              <KeyRound className="h-3 w-3 inline mr-1" />
              WWDR PEM
            </label>
            <textarea
              value={form.wwdrPem}
              onChange={(e) => update({ wwdrPem: e.target.value })}
              className={textareaCls}
              placeholder={wwdrPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            <p className={hintCls}>
              {settings?.hasCert && settings?.hasCertKey && settings?.hasWwdr
                ? 'Сертификаты загружены. Оставьте поля пустыми, чтобы не менять их.'
                : 'Apple WWDR (Worldwide Developer Relations) — промежуточный сертификат Apple для подписи карты.'}
            </p>
          </div>
        </div>

        {dirty && (
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить Apple Wallet
          </button>
        )}
      </QueryState>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const { isRole } = useAuth();
  const canManage = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  if (!canManage) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-sm" aria-label="Назад">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title">Интеграции</h1>
          <p className="text-sm text-gray-500">Онлайн-оплаты, фискализация чеков, телефония и Apple Wallet</p>
        </div>
      </div>

      <AcquiringCard />
      <FiscalCard />
      <TelephonyCard />
      <WalletCard />
    </div>
  );
}
