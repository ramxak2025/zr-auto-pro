import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Bell,
  Car,
  CalendarClock,
  CheckCircle2,
  MessageSquare,
  Repeat,
  Send,
  ShieldCheck,
  Star,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { marketingApi } from '../../api/services';
import type { SentMessage, SentMessageType, SentMessagesResponse } from '../../types';
import { LoadingBlock } from './marketingKit';

// ─── Журнал отправок («что реально ушло клиентам») ──────────────────
// Лента sent_messages: каждое сообщение — тип, канал, кому, когда, статус.
// Текста сообщения в журнале нет (сервер хранит только hash — анти-дубль).
// Лимиты анти-спам-гейта приходят в meta с сервера — гарантии показываются
// из первоисточника, не хардкодом.

const TYPE_META: Record<SentMessageType, { label: string; icon: LucideIcon; iconClass: string }> = {
  review: { label: 'Запрос отзыва', icon: Star, iconClass: 'bg-amber-50 text-amber-600' },
  car_ready: { label: 'Машина готова', icon: Car, iconClass: 'bg-blue-50 text-blue-600' },
  reminder: { label: 'Напоминание', icon: Bell, iconClass: 'bg-violet-50 text-violet-600' },
  winback: { label: 'Возврат клиентов', icon: Repeat, iconClass: 'bg-teal-50 text-teal-600' },
  booking: { label: 'Запись', icon: CalendarClock, iconClass: 'bg-indigo-50 text-indigo-600' },
  manual: { label: 'Сообщение', icon: MessageSquare, iconClass: 'bg-gray-100 text-gray-500' },
  broadcast: { label: 'Рассылка', icon: Send, iconClass: 'bg-emerald-50 text-emerald-600' },
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  smsru: 'SMS.RU',
  moizvonki: 'Мои Звонки',
  sms: 'SMS',
  email: 'Email',
};

const FILTERS: { key: SentMessageType | null; label: string }[] = [
  { key: null, label: 'Все' },
  { key: 'review', label: 'Отзывы' },
  { key: 'car_ready', label: 'Машина готова' },
  { key: 'broadcast', label: 'Рассылки' },
  { key: 'reminder', label: 'Напоминания' },
  { key: 'winback', label: 'Возврат' },
  { key: 'booking', label: 'Записи' },
];

/** Нормализованный 10-значный ключ → «+7 988 444-44-85». */
function formatPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length !== 10) return phone || '—';
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

function formatWhen(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(dt, now)) return `Сегодня, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(dt, yesterday)) return `Вчера, ${time}`;
  const date = dt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${date}, ${time}`;
}

function JournalRow({ m }: { m: SentMessage }) {
  const meta = TYPE_META[m.messageType] ?? TYPE_META.manual;
  const Icon = meta.icon;
  const failed = m.status === 'failed';
  const channel = m.providerType ? (CHANNEL_LABEL[m.providerType] ?? m.providerType) : null;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.iconClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
            {m.toOwner ? 'В чат владельца' : m.clientName || formatPhone(m.phone)}
          </p>
          <p className="flex-shrink-0 text-xs tabular-nums text-gray-400">{formatWhen(m.sentAt)}</p>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
            {meta.label}
            {channel ? ` · ${channel}` : ''}
          </p>
          {failed ? (
            <span className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-red-500">
              <XCircle className="h-3.5 w-3.5" /> Ошибка
            </span>
          ) : (
            <span className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Отправлено
            </span>
          )}
        </div>
        {m.toOwner && <p className="mt-0.5 text-xs text-gray-400">Telegram-бот пишет владельцу, не клиенту</p>}
        {failed && m.error && <p className="mt-0.5 truncate text-xs text-red-400">{m.error}</p>}
      </div>
    </div>
  );
}

export default function JournalView() {
  const [typeFilter, setTypeFilter] = useState<SentMessageType | null>(null);

  const query = useInfiniteQuery<SentMessagesResponse>({
    queryKey: ['marketing', 'sent-messages', typeFilter],
    queryFn: async ({ pageParam }) =>
      (
        await marketingApi.getSentMessages({
          cursor: (pageParam as string) || undefined,
          limit: 30,
          type: typeFilter ?? undefined,
        })
      ).data,
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
  });

  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p?.data ?? []), [query.data]);
  const meta = query.data?.pages?.[0]?.meta;
  const cap = meta?.perClient24hCap ?? 3;
  const guaranteeLine = `Не больше ${cap} сообщений клиенту за 24 часа, повторы отсекаются автоматически.`;

  return (
    <div className="space-y-4">
      {/* Гарантии — из meta сервера */}
      <div className="flex items-start gap-2.5 rounded-xl border border-green-100 bg-green-50 px-3.5 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
        <p className="text-xs text-green-800">
          Здесь видно каждое сообщение, которое ушло вашим клиентам. {guaranteeLine}
        </p>
      </div>

      {/* Фильтр по типу */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => {
          const active = typeFilter === f.key;
          return (
            <button
              key={f.key ?? 'all'}
              onClick={() => setTypeFilter(f.key)}
              className={`press-soft flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Лента */}
      <div className="card overflow-hidden">
        {query.isLoading ? (
          <LoadingBlock className="py-10" />
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-green-200" />
            <p className="text-sm font-medium text-gray-700">
              {typeFilter ? 'Таких отправок ещё не было' : 'Здесь видно каждое сообщение'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
              {typeFilter
                ? 'Как только сообщение этого типа уйдёт клиенту — оно появится в этой ленте.'
                : `Каждое сообщение вашим клиентам попадает в этот журнал: что, кому, когда и каким каналом. ${guaranteeLine}`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {rows.map((m) => (
              <JournalRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      {query.hasNextPage && (
        <button
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="btn-secondary w-full"
        >
          {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </div>
  );
}
