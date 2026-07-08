import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Bell, CalendarClock, CreditCard, Info, Loader2, Send, ShieldCheck, Star, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

import { marketingApi } from '../../api/services';
import type {
  AutoMailingOverview,
  MessagingIntegration,
  SegmentBroadcastCriteria,
  SegmentBroadcastResult,
} from '../../types';
import type { SettingsSection } from './MarketingSettingsView';
import { EmptyState, LoadingBlock, SectionCard, lastVisitLabel, plural } from './marketingKit';

const PROVIDER_LABELS: Record<string, string> = {
  moizvonki: 'Мои Звонки',
  smsru: 'SMS.RU',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  email: 'Email',
};
const MESSAGING_TYPES = ['whatsapp', 'smsru', 'telegram', 'sms', 'email'];

const WINBACK_PRESETS = [30, 60, 90, 180];
const DEFAULT_MESSAGE = 'Здравствуйте! Давно не виделись — будем рады видеть вас снова. Запишитесь на удобное время.';

type SegmentKind = 'winback' | 'source' | 'debt';

// ─── Auto-mailing overview row ──────────────────────────────────────
const AUTO_META: Record<
  AutoMailingOverview['type'],
  { label: string; icon: typeof Star; iconClass: string; section: SettingsSection }
> = {
  review: { label: 'Запрос отзыва', icon: Star, iconClass: 'bg-amber-50 text-amber-600', section: 'review' },
  car_ready: {
    label: 'Готовность авто',
    icon: Bell,
    iconClass: 'bg-emerald-50 text-emerald-600',
    section: 'car-ready',
  },
  installment_reminder: {
    label: 'Напоминания по рассрочкам',
    icon: CreditCard,
    iconClass: 'bg-indigo-50 text-indigo-600',
    section: 'installments',
  },
  service_reminder: {
    label: 'Напоминание о визите',
    icon: CalendarClock,
    iconClass: 'bg-sky-50 text-sky-600',
    section: 'service',
  },
};

function AutoMailings({ onGoToSettings }: { onGoToSettings: (s: SettingsSection) => void }) {
  const { data: mailings = [], isLoading } = useQuery({
    queryKey: ['marketing', 'auto-mailings'],
    queryFn: () => marketingApi.getAutoMailings().then((r) => r.data),
  });

  return (
    <SectionCard
      icon={Zap}
      iconClass="bg-primary-50 text-primary-600"
      title="Автоматические рассылки"
      subtitle="Отправляются сами по событиям — тексты в разделе «Настройки»"
    >
      {isLoading ? (
        <LoadingBlock className="py-6" />
      ) : mailings.length === 0 ? (
        <EmptyState icon={Zap} title="Автоматические рассылки не настроены" />
      ) : (
        <div className="space-y-2">
          {mailings.map((m: AutoMailingOverview) => {
            const meta = AUTO_META[m.type];
            const Icon = meta?.icon ?? Zap;
            return (
              <div key={m.type} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
                <span
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta?.iconClass ?? 'bg-gray-100 text-gray-500'}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{meta?.label ?? m.type}</p>
                    <span className={m.enabled ? 'badge-green' : 'badge-gray'}>{m.enabled ? 'вкл' : 'выкл'}</span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{m.summary}</p>
                </div>
                {meta && (
                  <button onClick={() => onGoToSettings(meta.section)} className="btn-secondary btn-sm flex-shrink-0">
                    Изменить
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Manual segment broadcast ───────────────────────────────────────
function ManualBroadcast() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SegmentKind>('winback');
  const [days, setDays] = useState(90);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [integrationId, setIntegrationId] = useState<string>('');
  const [result, setResult] = useState<SegmentBroadcastResult | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  // Connected messaging channels (telephony excluded).
  const { data: integrations = [] } = useQuery({
    queryKey: ['marketing', 'integrations'],
    queryFn: () => marketingApi.getIntegrations().then((r) => r.data),
  });
  const channels = integrations.filter(
    (i: MessagingIntegration) => MESSAGING_TYPES.includes(i.providerType) && i.isActive,
  );

  // Win-back is the only segment with a live preview endpoint.
  const preview = useQuery({
    queryKey: ['marketing', 'winback', days],
    queryFn: () => marketingApi.winback(days).then((r) => r.data),
    enabled: kind === 'winback',
    placeholderData: keepPreviousData,
  });
  const previewClients = kind === 'winback' ? (preview.data ?? []) : [];
  const previewTotal = previewClients.length;

  const criteria: SegmentBroadcastCriteria = useMemo(() => {
    if (kind === 'winback') return { lastVisitDays: days };
    if (kind === 'source') return source.trim() ? { source: source.trim() } : {};
    return { hasDebt: true };
  }, [kind, days, source]);

  const send = useMutation({
    mutationFn: () =>
      marketingApi
        .sendSegmentBroadcast({
          segment: criteria,
          message: message.trim(),
          integrationId: integrationId || undefined,
          idempotencyKey: idempotencyKey.current,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      setResult(res);
      idempotencyKey.current = crypto.randomUUID(); // fresh key for the next distinct send
      qc.invalidateQueries({ queryKey: ['marketing', 'winback'] });
    },
    onError: () => toast.error('Не удалось отправить рассылку'),
  });

  const trimmed = message.trim();
  const sourceMissing = kind === 'source' && !source.trim();
  const canSend = trimmed.length > 0 && !sourceMissing && !send.isPending;

  const segments: { key: SegmentKind; label: string }[] = [
    { key: 'winback', label: 'Давно не приезжали' },
    { key: 'source', label: 'По источнику' },
    { key: 'debt', label: 'Есть долг' },
  ];

  return (
    <SectionCard
      icon={Send}
      iconClass="bg-emerald-50 text-emerald-600"
      title="Ручная рассылка по сегменту"
      subtitle="Выберите, кому и через какой канал отправить сообщение"
    >
      <div className="space-y-4">
        {/* Segment */}
        <div>
          <label className="label">Кому отправить</label>
          <div className="flex flex-wrap gap-2">
            {segments.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setKind(s.key);
                  setResult(null);
                }}
                className={`press-soft rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  kind === s.key
                    ? 'border-primary-200 bg-primary-50 text-primary-700'
                    : 'border-transparent bg-gray-50 text-gray-500'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {kind === 'winback' && (
          <div>
            <label className="label">Не приезжали более</label>
            <div className="flex gap-2">
              {WINBACK_PRESETS.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDays(d);
                    setResult(null);
                  }}
                  className={`press-soft flex-1 rounded-xl border py-2 text-sm font-semibold transition-colors ${
                    days === d
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-transparent bg-gray-50 text-gray-500'
                  }`}
                >
                  {d} дн.
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === 'source' && (
          <div>
            <label className="label">Источник клиента</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="input"
              placeholder="Напр. Instagram, Авито, по рекомендации"
            />
            <p className="mt-1 text-xs text-gray-400">Точное значение поля «источник» в карточке клиента.</p>
          </div>
        )}

        {/* Preview (win-back only) */}
        {kind === 'winback' && (
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-900">Получатели</span>
              </div>
              <span className="text-sm font-bold tabular-nums text-primary-600">{previewTotal}</span>
            </div>
            {preview.isLoading ? (
              <LoadingBlock className="py-8" />
            ) : previewTotal === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Нет клиентов, которые так давно не приезжали</p>
            ) : (
              <div className="max-h-64 divide-y divide-gray-50 overflow-y-auto">
                {previewClients.map((c) => (
                  <div key={c.clientId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{c.name || 'Без имени'}</p>
                      <p className="truncate text-xs text-gray-400">{c.phone || '—'}</p>
                    </div>
                    <p className="flex-shrink-0 text-xs font-medium text-gray-600">{lastVisitLabel(c.lastVisit)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {kind !== 'winback' && (
          <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-800">
              Точное число получателей и результат покажем сразу после отправки — дубли отсеет анти-спам-фильтр.
            </p>
          </div>
        )}

        {/* Channel */}
        <div>
          <label className="label">Канал</label>
          <select value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} className="input">
            <option value="">Канал по умолчанию</option>
            {channels.map((c: MessagingIntegration) => (
              <option key={c.id} value={c.id}>
                {PROVIDER_LABELS[c.providerType] || c.providerType}
                {c.senderName ? ` · ${c.senderName}` : ''}
              </option>
            ))}
          </select>
          {channels.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Нет активных каналов рассылок — подключите их в разделе «Интеграции».
            </p>
          )}
        </div>

        {/* Message */}
        <div>
          <label className="label">Сообщение</label>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="input resize-none"
            placeholder="Текст сообщения для клиентов…"
          />
        </div>

        <button onClick={() => send.mutate()} disabled={!canSend} className="btn-primary w-full">
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Отправить{kind === 'winback' && previewTotal > 0 ? ` (${previewTotal})` : ''}
        </button>

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-xl font-bold tabular-nums text-green-600">{result.sent}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Отправлено</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums text-amber-600">{result.skippedDedup}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Дубли</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums text-red-500">{result.failed}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Ошибок</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums text-gray-900">{result.total}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Всего</p>
              </div>
            </div>
            {result.sent === 0 && result.total > 0 && result.skippedDedup === result.total && (
              <p className="mt-3 text-center text-xs text-gray-500">
                Все получатели уже получали это сообщение недавно — анти-спам-фильтр не отправил повторно.
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export default function BroadcastsView({ onGoToSettings }: { onGoToSettings: (s: SettingsSection) => void }) {
  return (
    <div className="space-y-5">
      {/* Anti-spam reassurance */}
      <div className="flex items-start gap-2.5 rounded-xl border border-green-100 bg-green-50 px-3.5 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
        <p className="text-xs text-green-800">
          Защита от спама включена: одному клиенту не уйдёт одинаковое сообщение дважды за короткий срок. Повторы
          попадают в «Дубли» и не тратят деньги.
        </p>
      </div>

      <ManualBroadcast />
      <AutoMailings onGoToSettings={onGoToSettings} />

      <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-3.5 py-3">
        <Bell className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
        <p className="text-xs text-gray-500">
          {plural(WINBACK_PRESETS.length, ['Пресет', 'Пресета', 'Пресетов'])} «давно не приезжали» (30 / 60 / 90 / 180
          дней) — это готовые сегменты для возврата клиентов.
        </p>
      </div>
    </div>
  );
}
