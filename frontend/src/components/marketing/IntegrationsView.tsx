import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Info, MessageSquare, Pencil, Phone, Plus, Receipt, Trash2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

import { marketingApi } from '../../api/services';
import type { MessagingIntegration } from '../../types';
import { LoadingBlock, SectionCard } from './marketingKit';

type ProviderType = MessagingIntegration['providerType'];

const PROVIDER_LABELS: Record<string, string> = {
  moizvonki: 'Мои Звонки',
  smsru: 'SMS.RU',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  email: 'Email',
};

const TELEPHONY_TYPES: ProviderType[] = ['moizvonki'];
const MESSAGING_TYPES: ProviderType[] = ['whatsapp', 'smsru', 'telegram', 'sms', 'email'];

const emptyForm = {
  providerType: 'whatsapp' as ProviderType,
  apiKey: '',
  senderName: '',
  senderPhone: '',
  webhookUrl: '',
  phoneNumberId: '',
  chatId: '',
};
type FormState = typeof emptyForm;

// ─── Add / edit form (provider-specific fields) ─────────────────────
function IntegrationForm({
  allowedTypes,
  editing,
  saving,
  onSave,
  onCancel,
}: {
  allowedTypes: ProviderType[];
  editing: MessagingIntegration | null;
  saving: boolean;
  onSave: (data: FormState & { id?: string }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (editing) {
      return {
        providerType: editing.providerType,
        apiKey: '', // write-only — never returned by the backend
        senderName: editing.senderName || '',
        senderPhone: editing.senderPhone || '',
        webhookUrl: editing.webhookUrl || '',
        phoneNumberId: editing.phoneNumberId || '',
        chatId: editing.chatId || '',
      };
    }
    return { ...emptyForm, providerType: allowedTypes[0] };
  });

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="mb-4 space-y-3 rounded-xl bg-gray-50 p-3">
      {allowedTypes.length > 1 && (
        <div>
          <label className="label">Тип</label>
          <select
            value={form.providerType}
            onChange={(e) => set({ providerType: e.target.value as ProviderType })}
            disabled={!!editing}
            className="input disabled:bg-gray-100 disabled:text-gray-500"
          >
            {allowedTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'sms' ? 'SMS (другой провайдер)' : PROVIDER_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      {form.providerType === 'moizvonki' && (
        <>
          <div>
            <label className="label">Домен (поддомен в moizvonki.ru)</label>
            <div className="flex items-center">
              <input
                value={form.webhookUrl}
                onChange={(e) => set({ webhookUrl: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                className="input rounded-r-none"
                placeholder="mycompany"
              />
              <span className="rounded-r-lg border border-l-0 border-gray-300 bg-gray-100 px-3 py-2.5 text-xs text-gray-500">
                .moizvonki.ru
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Если адрес mycompany.moizvonki.ru — введите mycompany</p>
          </div>
          <div>
            <label className="label">Email (логин в Мои Звонки)</label>
            <input
              type="email"
              value={form.senderName}
              onChange={(e) => set({ senderName: e.target.value })}
              className="input"
              placeholder="user@mail.ru"
            />
          </div>
          <div>
            <label className="label">Ключ API</label>
            <input
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              className="input"
              placeholder={editing ? 'Оставьте пустым, чтобы не менять' : 'Настройки → Интеграция → Ключ API'}
            />
          </div>
        </>
      )}

      {form.providerType === 'smsru' && (
        <>
          <div>
            <label className="label">API ID (из кабинета sms.ru)</label>
            <input
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              className="input"
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            />
          </div>
          <div>
            <label className="label">Имя отправителя (опц.)</label>
            <input
              value={form.senderName}
              onChange={(e) => set({ senderName: e.target.value })}
              className="input"
              placeholder="Одобренное в sms.ru"
            />
          </div>
        </>
      )}

      {form.providerType === 'whatsapp' && (
        <>
          <div>
            <label className="label">Access token (постоянный)</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              className="input"
              placeholder={editing ? 'Оставьте пустым, чтобы не менять' : 'Bearer-токен WhatsApp Cloud API'}
            />
            <p className="mt-1 text-xs text-gray-400">Хранится зашифрованно и не показывается повторно.</p>
          </div>
          <div>
            <label className="label">Phone number ID</label>
            <input
              value={form.phoneNumberId}
              onChange={(e) => set({ phoneNumberId: e.target.value })}
              className="input"
              placeholder="напр. 123456789012345"
            />
            <p className="mt-1 text-xs text-gray-400">Meta for Developers → WhatsApp → API Setup → Phone number ID.</p>
          </div>
        </>
      )}

      {form.providerType === 'telegram' && (
        <>
          <div>
            <label className="label">Токен бота</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              className="input"
              placeholder={editing ? 'Оставьте пустым, чтобы не менять' : '123456:ABC-DEF1234...'}
            />
            <p className="mt-1 text-xs text-gray-400">Получите у @BotFather. Хранится зашифрованно.</p>
          </div>
          <div>
            <label className="label">Chat ID</label>
            <input
              value={form.chatId}
              onChange={(e) => set({ chatId: e.target.value })}
              className="input"
              placeholder="напр. -1001234567890"
            />
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-800">
              Telegram-бот не пишет клиенту на телефон — уведомление приходит в указанный чат владельца или сотрудников.
            </p>
          </div>
        </>
      )}

      {(form.providerType === 'sms' || form.providerType === 'email') && (
        <>
          <div>
            <label className="label">API ключ</label>
            <input
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              className="input"
              placeholder={editing ? 'Оставьте пустым, чтобы не менять' : 'Ваш API ключ'}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Имя отправителя</label>
              <input value={form.senderName} onChange={(e) => set({ senderName: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Телефон</label>
              <input
                value={form.senderPhone}
                onChange={(e) => set({ senderPhone: e.target.value })}
                className="input"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-secondary btn-sm flex-1">
          Отмена
        </button>
        <button
          onClick={() => onSave(editing ? { ...form, id: editing.id } : form)}
          disabled={saving}
          className="btn-primary btn-sm flex-1"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

// ─── One provider row ───────────────────────────────────────────────
function ProviderRow({
  integration,
  onEdit,
  onRemove,
}: {
  integration: MessagingIntegration;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${integration.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
          title={integration.isActive ? 'Активен' : 'Отключён'}
        />
        <span className="text-sm font-medium text-gray-900">
          {PROVIDER_LABELS[integration.providerType] || integration.providerType}
        </span>
        {integration.senderName && <span className="truncate text-xs text-gray-500">({integration.senderName})</span>}
        {integration.providerType === 'whatsapp' && integration.phoneNumberId && (
          <span className="truncate text-xs text-gray-500">· ID {integration.phoneNumberId}</span>
        )}
        {integration.providerType === 'telegram' && integration.chatId && (
          <span className="truncate text-xs text-gray-500">· чат {integration.chatId}</span>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button onClick={onEdit} className="press-soft p-1 text-gray-400 hover:text-primary-600" aria-label="Изменить">
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={onRemove} className="press-soft p-1 text-gray-400 hover:text-red-500" aria-label="Удалить">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── A configurable group (telephony OR messaging) ──────────────────
function ConfigurableGroup({
  icon,
  iconClass,
  title,
  subtitle,
  allowedTypes,
  integrations,
  emptyLabel,
}: {
  icon: typeof Phone;
  iconClass: string;
  title: string;
  subtitle: string;
  allowedTypes: ProviderType[];
  integrations: MessagingIntegration[];
  emptyLabel: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MessagingIntegration | null>(null);

  const rows = integrations.filter((i) => allowedTypes.includes(i.providerType));

  const upsert = useMutation({
    mutationFn: (data: FormState & { id?: string }) => marketingApi.upsertIntegration(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'integrations'], fresh);
      setOpen(false);
      setEditing(null);
      toast.success('Провайдер сохранён');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => marketingApi.removeIntegration(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<MessagingIntegration[]>(['marketing', 'integrations'], (prev) =>
        (prev ?? []).filter((i) => i.id !== id),
      );
      toast.success('Удалено');
    },
    onError: () => toast.error('Ошибка удаления'),
  });

  return (
    <SectionCard
      icon={icon}
      iconClass={iconClass}
      title={title}
      subtitle={subtitle}
      right={
        <button
          onClick={() => {
            setEditing(null);
            setOpen((v) => !v);
          }}
          className="press-soft rounded-lg p-1 text-primary-600 hover:bg-primary-50"
          aria-label="Добавить"
        >
          <Plus className="h-5 w-5" />
        </button>
      }
    >
      {open && (
        <IntegrationForm
          allowedTypes={allowedTypes}
          editing={editing}
          saving={upsert.isPending}
          onSave={(d) => upsert.mutate(d)}
          onCancel={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      )}

      {rows.length === 0 && !open ? (
        <p className="py-4 text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((i) => (
            <ProviderRow
              key={i.id}
              integration={i}
              onEdit={() => {
                setEditing(i);
                setOpen(true);
              }}
              onRemove={() => remove.mutate(i.id)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Placeholder group (no backend yet — honest «по запросу») ───────
function PlannedGroup({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  body,
}: {
  icon: typeof Receipt;
  iconClass: string;
  title: string;
  subtitle: string;
  body: string;
}) {
  return (
    <SectionCard
      icon={Icon}
      iconClass={iconClass}
      title={title}
      subtitle={subtitle}
      right={<span className="badge-gray">по запросу</span>}
    >
      <p className="text-sm text-gray-500">{body}</p>
    </SectionCard>
  );
}

export default function IntegrationsView() {
  const { data: integrations, isLoading } = useQuery({
    queryKey: ['marketing', 'integrations'],
    queryFn: () => marketingApi.getIntegrations().then((r) => r.data),
  });

  if (isLoading || !integrations) return <LoadingBlock />;

  return (
    <div className="space-y-5">
      <ConfigurableGroup
        icon={Phone}
        iconClass="bg-sky-50 text-sky-600"
        title="Телефония"
        subtitle="Интеграция звонков — воронка обращений и пропущенные"
        allowedTypes={TELEPHONY_TYPES}
        integrations={integrations}
        emptyLabel="Мои Звонки не подключены"
      />

      <ConfigurableGroup
        icon={MessageSquare}
        iconClass="bg-emerald-50 text-emerald-600"
        title="Каналы рассылок"
        subtitle="Через что уходят сообщения клиентам — WhatsApp, SMS.RU, Telegram"
        allowedTypes={MESSAGING_TYPES}
        integrations={integrations}
        emptyLabel="Каналы рассылок не подключены"
      />

      <PlannedGroup
        icon={Receipt}
        iconClass="bg-indigo-50 text-indigo-600"
        title="Онлайн-касса (54-ФЗ)"
        subtitle="Фискализация чеков"
        body="Подключение фискального накопителя настраивается через поддержку. Напишите нам — поможем связать кассу с Autexa."
      />

      <PlannedGroup
        icon={CreditCard}
        iconClass="bg-amber-50 text-amber-600"
        title="Эквайринг"
        subtitle="Приём оплаты картой"
        body="Приём безналичной оплаты подключается индивидуально по вашему банку-эквайеру. Оставьте заявку в поддержке."
      />

      <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-3.5 py-3">
        <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
        <p className="text-xs text-gray-500">
          Тексты сообщений и площадки для отзывов настраиваются в разделе «Настройки», а сами рассылки — в разделе
          «Рассылки».
        </p>
      </div>
    </div>
  );
}
