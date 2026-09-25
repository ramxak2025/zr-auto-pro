import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Bell,
  Car,
  CalendarClock,
  MessageSquare,
  Repeat,
  Send,
  ShieldCheck,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { marketingApi } from '../../api/services';
import type { SentMessage, SentMessageType, SentMessagesResponse } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Tabs } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import { toneChip } from '../../ui/tokens';
import UiEmptyState from '../EmptyState';
import { InfoNote, LoadingBlock, SectionError } from './marketingKit';

// ─── Журнал отправок («что реально ушло клиентам») ──────────────────
// Лента sent_messages: каждое сообщение — тип, канал, кому, когда, статус.
// Текста сообщения в журнале нет (сервер хранит только hash — анти-дубль).
// Лимиты анти-спам-гейта приходят в meta с сервера — гарантии показываются
// из первоисточника, не хардкодом.

const TYPE_META: Record<SentMessageType, { label: string; icon: LucideIcon }> = {
  review: { label: 'Запрос отзыва', icon: Star },
  car_ready: { label: 'Машина готова', icon: Car },
  reminder: { label: 'Напоминание', icon: Bell },
  winback: { label: 'Возврат клиентов', icon: Repeat },
  booking: { label: 'Запись', icon: CalendarClock },
  manual: { label: 'Сообщение', icon: MessageSquare },
  broadcast: { label: 'Рассылка', icon: Send },
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  smsru: 'SMS.RU',
  moizvonki: 'Мои Звонки',
  sms: 'SMS',
  email: 'Email',
};

type FilterKey = 'all' | SentMessageType;
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'review', label: 'Отзывы' },
  { key: 'car_ready', label: 'Машина готова' },
  { key: 'broadcast', label: 'Рассылки' },
  { key: 'reminder', label: 'Напоминания' },
  { key: 'winback', label: 'Возврат' },
  { key: 'booking', label: 'Записи' },
];
const FILTER_KEYS = FILTERS.map((f) => f.key);

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
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', toneChip.neutral)}
        role="img"
        aria-label={meta.label}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {m.toOwner ? 'В чат владельца' : m.clientName || formatPhone(m.phone)}
          </p>
          <p className="flex-shrink-0 text-xs tabular-nums text-ink-3">{formatWhen(m.sentAt)}</p>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-ink-3">
            {meta.label}
            {channel ? ` · ${channel}` : ''}
          </p>
          {failed ? (
            <Badge tone="bad" size="sm" dot>
              Ошибка
            </Badge>
          ) : (
            <Badge tone="ok" size="sm" dot>
              Отправлено
            </Badge>
          )}
        </div>
        {m.toOwner && <p className="mt-0.5 text-xs text-ink-3">Telegram-бот пишет владельцу, не клиенту</p>}
        {failed && m.error && <p className="mt-0.5 truncate text-xs text-bad-text">{m.error}</p>}
      </div>
    </li>
  );
}

export default function JournalView() {
  // Фильтр по типу — в URL (?type=review) рядом с вкладкой маркетинга.
  const [params, setParams] = useSearchParams();
  const rawType = params.get('type') as FilterKey | null;
  const filter: FilterKey = rawType && FILTER_KEYS.includes(rawType) ? rawType : 'all';
  const typeFilter: SentMessageType | null = filter === 'all' ? null : filter;
  const setFilter = (key: FilterKey) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (key === 'all') p.delete('type');
        else p.set('type', key);
        return p;
      },
      { replace: true },
    );

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
    <div className="max-w-4xl space-y-4">
      {/* Гарантии — из meta сервера */}
      <InfoNote icon={ShieldCheck} tone="ok">
        Здесь видно каждое сообщение, которое ушло вашим клиентам. {guaranteeLine}
      </InfoNote>

      {/* Фильтр по типу */}
      <Tabs
        aria-label="Тип сообщения"
        idPrefix="journal"
        variant="pills"
        size="sm"
        items={FILTERS}
        value={filter}
        onChange={setFilter}
      />

      {/* Лента */}
      <Card padding="none" role="tabpanel" id={`journal-panel-${filter}`} aria-labelledby={`journal-tab-${filter}`}>
        {query.isLoading ? (
          <LoadingBlock className="px-4" lines={5} />
        ) : query.isError ? (
          <div className="p-4">
            <SectionError
              message="Не удалось загрузить журнал отправок"
              onRetry={() => query.refetch()}
              loading={query.isFetching}
            />
          </div>
        ) : rows.length === 0 ? (
          <UiEmptyState
            icon={ShieldCheck}
            title={typeFilter ? 'Таких отправок ещё не было' : 'Здесь видно каждое сообщение'}
            description={
              typeFilter
                ? 'Как только сообщение этого типа уйдёт клиенту — оно появится в этой ленте.'
                : `Каждое сообщение вашим клиентам попадает в этот журнал: что, кому, когда и каким каналом. ${guaranteeLine}`
            }
            compact
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <JournalRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </Card>

      {query.hasNextPage && (
        <Button variant="secondary" fullWidth onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
          Показать ещё
        </Button>
      )}
    </div>
  );
}
