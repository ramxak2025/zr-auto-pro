import { useState, useMemo, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneForwarded,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  Pause,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { formatTimeShort } from '../../../shared/utils/formatters';
import { useAuth } from '../contexts/AuthContext';
import { callsApi } from '../api/services';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { ErrorRow } from '../components/dashboard/shared';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { StatCard } from '../ui/StatCard';
import { Tabs } from '../ui/Tabs';
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '../ui/Toolbar';
import { cn } from '../ui/cn';
import { focusRing, toneChip, type Tone } from '../ui/tokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Call {
  id: string;
  date: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string;
  duration: number;
  status: 'answered' | 'missed';
  recordingUrl: string | null;
  clientPhone: string;
  calledBack?: boolean;
  client: {
    id: string;
    fullName: string;
    cars: { plateNumber: string; makeModel: string }[];
  } | null;
}

interface CallsSummary {
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
  total: number;
}

type FilterTab = 'all' | 'incoming' | 'outgoing' | 'missed';
const FILTER_TABS: FilterTab[] = ['all', 'incoming', 'outgoing', 'missed'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  // Normalize: 8xxx -> 7xxx
  if (cleaned.length === 11 && cleaned[0] === '8') {
    cleaned = '7' + cleaned.slice(1);
  }
  if (cleaned.length === 11) {
    return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
  }
  return phone;
}

/** 'YYYY-MM-DD' → локальная Date без сдвига пояса (для календарной арифметики и подписи). */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Соседний день от ключа — чистая календарная арифметика, пояс машины не влияет. */
function shiftDayKey(key: string, days: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** «25 сентября, пт» → «25 сентября, пт» с заглавной первой буквой (не CSS по словам). */
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Audio player (inline, not modal)
// ---------------------------------------------------------------------------

function AudioPlayer({ recordingId, onClose }: { recordingId: string; onClose: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callsApi.getRecordingUrl(recordingId);
        if (cancelled) return;
        const audio = new Audio(res.data.url);
        audioRef.current = audio;
        audio.addEventListener('loadedmetadata', () => {
          setDuration(audio.duration);
          setLoading(false);
        });
        audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
        audio.addEventListener('ended', () => setPlaying(false));
        audio.addEventListener('error', () => {
          setError('Не удалось воспроизвести запись');
          setLoading(false);
        });
        audio.load();
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить запись');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [recordingId]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play();
      setPlaying(true);
    }
  }, [playing]);

  const seekTo = useCallback(
    (time: number) => {
      const a = audioRef.current;
      if (!a || !duration) return;
      a.currentTime = Math.max(0, Math.min(duration, time));
      setCurrent(a.currentTime);
    },
    [duration],
  );

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      const bar = progressRef.current;
      if (!bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekTo(pct * duration);
    },
    [duration, seekTo],
  );

  // Клавиатура на ползунке: ←/→ — 5 с, Home/End — в начало/конец.
  const onSliderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') seekTo(currentTime + 5);
    else if (e.key === 'ArrowLeft') seekTo(currentTime - 5);
    else if (e.key === 'Home') seekTo(0);
    else if (e.key === 'End') seekTo(duration);
    else if (e.key === ' ' || e.key === 'Enter') togglePlay();
    else return;
    e.preventDefault();
  };

  const fmtTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="mx-4 mb-3 rounded-lg border border-accent/20 bg-accent-soft px-3 py-2.5 motion-safe:animate-pop-in">
      <div className="flex items-center gap-3">
        <IconButton
          label={playing ? 'Пауза' : 'Воспроизвести'}
          icon={playing ? Pause : Play}
          variant="primary"
          onClick={togglePlay}
          disabled={loading || !!error}
          loading={loading}
          className="rounded-full"
        />

        <div className="min-w-0 flex-1">
          {error ? (
            <p className="text-xs text-bad-text" role="alert">
              {error}
            </p>
          ) : (
            <>
              <div
                ref={progressRef}
                role="slider"
                aria-label="Перемотка записи"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration) || 0}
                aria-valuenow={Math.round(currentTime)}
                aria-valuetext={`${fmtTime(currentTime)} из ${fmtTime(duration)}`}
                tabIndex={0}
                className={cn('relative h-1.5 cursor-pointer rounded-full bg-accent/20', focusRing)}
                onClick={seek}
                onTouchStart={seek}
                onTouchMove={seek}
                onKeyDown={onSliderKey}
              >
                <div className="absolute left-0 top-0 h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-2xs tabular-nums text-accent-text">
                <span>{fmtTime(currentTime)}</span>
                <span>{fmtTime(duration)}</span>
              </div>
            </>
          )}
        </div>

        <IconButton label="Закрыть плеер" icon={X} size="sm" onClick={onClose} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call row
// ---------------------------------------------------------------------------

function CallRow({
  call,
  canListen,
  activeRecording,
  onPlayRecording,
  timeZone,
}: {
  call: Call;
  canListen: boolean;
  activeRecording: string | null;
  onPlayRecording: (id: string | null) => void;
  /**
   * Пояс автосервиса (157): сервер режет ленту звонков по МЕСТНЫМ суткам
   * тенанта, поэтому и время звонка на строке обязано быть местным — иначе
   * звонок «в 23:40» лежит в дне, который на экране называется следующим.
   */
  timeZone: string;
}) {
  const isMissed = call.direction === 'incoming' && (call.status === 'missed' || call.duration === 0);
  const isIncoming = call.direction === 'incoming';
  const displayPhone = isIncoming ? call.from : call.to;
  const callTime = call.date ? formatTimeShort(call.date, timeZone) : '';
  const isPlaying = activeRecording === call.recordingUrl;

  const tone: Tone = isMissed ? (call.calledBack ? 'ok' : 'bad') : isIncoming ? 'ok' : 'info';
  const Icon = isMissed ? (call.calledBack ? PhoneForwarded : PhoneMissed) : isIncoming ? ArrowDownLeft : ArrowUpRight;
  const kindLabel = isMissed
    ? call.calledBack
      ? 'Пропущен, перезвонили'
      : 'Пропущен'
    : isIncoming
      ? 'Входящий'
      : 'Исходящий';

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span
          className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', toneChip[tone])}
          role="img"
          aria-label={kindLabel}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              isMissed && !call.calledBack ? 'text-bad-text' : 'text-ink',
            )}
          >
            {formatPhone(displayPhone)}
          </p>
          {call.client ? (
            <Link
              to={`/clients/${call.client.id}`}
              className={cn('mt-0.5 block truncate text-xs text-accent-text hover:underline', focusRing)}
            >
              {call.client.fullName}
              {call.client.cars?.[0] && ` · ${call.client.cars[0].makeModel || call.client.cars[0].plateNumber}`}
            </Link>
          ) : (
            <p className="mt-0.5 text-xs text-ink-3">Неизвестный номер</p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-xs tabular-nums text-ink-3">{callTime}</p>
            {call.duration > 0 && <p className="text-2xs tabular-nums text-ink-3">{formatDuration(call.duration)}</p>}
          </div>
          {isMissed && (
            <Badge tone={call.calledBack ? 'ok' : 'bad'} size="sm" className="hidden sm:inline-flex">
              {call.calledBack ? 'Перезвонили' : 'Пропущен'}
            </Badge>
          )}
          {canListen && call.recordingUrl && (
            <IconButton
              label={isPlaying ? 'Пауза' : 'Прослушать запись'}
              icon={isPlaying ? Pause : Play}
              size="sm"
              variant={isPlaying ? 'primary' : 'secondary'}
              active={isPlaying}
              className="rounded-full"
              onClick={() => onPlayRecording(isPlaying ? null : call.recordingUrl)}
            />
          )}
        </div>
      </div>

      {/* Inline audio player */}
      {isPlaying && call.recordingUrl && (
        <AudioPlayer recordingId={call.recordingUrl} onClose={() => onPlayRecording(null)} />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CallsPage() {
  const { hasPermission } = useAuth();
  // День ленты и время звонков — по календарю автосервиса, тому же, по которому
  // сервер отбирает звонки за дату.
  const { timeZone, today } = useTenantCalendar();
  const [activeRecording, setActiveRecording] = useState<string | null>(null);

  // День и вкладка — в URL: F5 и пересылка ссылки открывают тот же день.
  const [params, setParams] = useSearchParams();
  const rawDate = params.get('date');
  const dateStr = rawDate && DAY_KEY_RE.test(rawDate) && rawDate <= today ? rawDate : today;
  const rawTab = params.get('tab') as FilterTab | null;
  const activeTab: FilterTab = rawTab && FILTER_TABS.includes(rawTab) ? rawTab : 'all';

  const updateParams = (next: { date?: string; tab?: FilterTab }) => {
    setActiveRecording(null);
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const d = next.date ?? dateStr;
        const t = next.tab ?? activeTab;
        if (d && d !== today) p.set('date', d);
        else p.delete('date');
        if (t !== 'all') p.set('tab', t);
        else p.delete('tab');
        return p;
      },
      { replace: true },
    );
  };

  // Волна «права как в Битрикс24»: только матрица (байпас superadmin/director —
  // внутри hasPermission; admin — по правам роли из /auth/me).
  const canView = hasPermission('calls_view');
  const canListen = hasPermission('calls_listen');

  const isToday = dateStr === today;
  const dateLabel = useMemo(() => {
    if (dateStr === today) return 'Сегодня';
    if (dateStr === shiftDayKey(today, -1)) return 'Вчера';
    return ucFirst(format(parseDayKey(dateStr), 'd MMMM, EEEEEE', { locale: ru }));
  }, [dateStr, today]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['calls', dateStr],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: dateStr });
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: canView,
  });

  const calls = useMemo<Call[]>(() => data?.calls ?? [], [data]);
  const summary: CallsSummary | undefined = data?.summary;

  const filteredCalls = useMemo(() => {
    switch (activeTab) {
      case 'incoming':
        return calls.filter((c) => c.direction === 'incoming' && c.status === 'answered');
      case 'outgoing':
        return calls.filter((c) => c.direction === 'outgoing');
      case 'missed':
        return calls.filter((c) => c.direction === 'incoming' && (c.status === 'missed' || c.duration === 0));
      default:
        return calls;
    }
  }, [calls, activeTab]);

  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader title="Звонки" icon={Phone} />
        <Card>
          <EmptyState icon={Phone} title="Доступ ограничен" description="У вас нет прав для просмотра звонков" />
        </Card>
      </div>
    );
  }

  const tabItems = [
    { key: 'all' as const, label: 'Все', icon: Phone, count: summary?.total },
    { key: 'incoming' as const, label: 'Входящие', icon: PhoneIncoming, count: summary?.incoming },
    { key: 'outgoing' as const, label: 'Исходящие', icon: PhoneOutgoing, count: summary?.outgoing },
    { key: 'missed' as const, label: 'Пропущенные', icon: PhoneMissed, count: summary?.missed },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Звонки" icon={Phone} subtitle="История и записи разговоров по дням" />

      <Toolbar>
        <ToolbarGroup>
          <IconButton
            label="Предыдущий день"
            icon={ChevronLeft}
            variant="secondary"
            onClick={() => updateParams({ date: shiftDayKey(dateStr, -1) })}
          />
          <span className="min-w-[7.5rem] text-center text-sm font-semibold text-ink" aria-live="polite">
            {dateLabel}
          </span>
          <IconButton
            label="Следующий день"
            icon={ChevronRight}
            variant="secondary"
            disabled={isToday}
            onClick={() => updateParams({ date: shiftDayKey(dateStr, 1) })}
          />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Input
            type="date"
            aria-label="Выбрать день"
            value={dateStr}
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (DAY_KEY_RE.test(v) && v <= today) updateParams({ date: v });
            }}
            leftIcon={CalendarDays}
            className="!w-44"
          />
          {!isToday && (
            <Button variant="ghost" onClick={() => updateParams({ date: today })}>
              Сегодня
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact label="Входящие" value={summary?.incoming ?? 0} icon={ArrowDownLeft} loading={isLoading} />
        <StatCard compact label="Исходящие" value={summary?.outgoing ?? 0} icon={ArrowUpRight} loading={isLoading} />
        <StatCard
          compact
          label="Пропущено"
          value={summary?.missed ?? 0}
          icon={PhoneMissed}
          tone={(summary?.missed ?? 0) > 0 ? 'bad' : 'neutral'}
          loading={isLoading}
        />
        <StatCard
          compact
          label="Без перезвона"
          value={summary?.notCalledBack ?? 0}
          icon={PhoneForwarded}
          tone={(summary?.notCalledBack ?? 0) > 0 ? 'warn' : 'neutral'}
          hint={(summary?.notCalledBack ?? 0) > 0 ? 'нужно перезвонить' : undefined}
          onClick={(summary?.notCalledBack ?? 0) > 0 ? () => updateParams({ tab: 'missed' }) : undefined}
          loading={isLoading}
        />
      </div>

      {/* Filter tabs + Call list */}
      <Card padding="none">
        <div className="px-4 pt-1">
          <Tabs
            aria-label="Фильтр звонков"
            idPrefix="calls"
            items={tabItems}
            value={activeTab}
            onChange={(t) => updateParams({ tab: t })}
          />
        </div>

        <div role="tabpanel" id={`calls-panel-${activeTab}`} aria-labelledby={`calls-tab-${activeTab}`}>
          {isLoading ? (
            <ul className="divide-y divide-line" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton variant="text" className="w-40" />
                    <Skeleton variant="text" className="h-3 w-24" />
                  </div>
                  <Skeleton variant="text" className="w-10" />
                </li>
              ))}
            </ul>
          ) : isError ? (
            <div className="p-4">
              <ErrorRow
                message="Не удалось загрузить звонки. Проверьте подключение телефонии в «Маркетинг → Интеграции»."
                onRetry={() => refetch()}
                loading={isFetching}
              />
            </div>
          ) : filteredCalls.length === 0 ? (
            <EmptyState
              icon={Phone}
              title={activeTab === 'missed' ? 'Пропущенных нет' : 'Звонков за этот день нет'}
              description={activeTab === 'all' && !isToday ? 'Попробуйте другой день' : undefined}
              compact
            />
          ) : (
            <ul className="divide-y divide-line">
              {filteredCalls.map((call, idx) => (
                <CallRow
                  key={`${call.id}-${idx}`}
                  call={call}
                  canListen={canListen}
                  activeRecording={activeRecording}
                  onPlayRecording={setActiveRecording}
                  timeZone={timeZone}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {isFetching && !isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-ink-3" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Обновляем…
        </p>
      )}
    </div>
  );
}
