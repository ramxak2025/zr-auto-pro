import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
  AlertCircle,
  User,
  X,
  Volume2,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { format, subDays, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../contexts/AuthContext';
import { callsApi } from '../api/services';
import { UserRole } from '../types';

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
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
  }
  return phone;
}

// ---------------------------------------------------------------------------
// Audio player (inline, not modal)
// ---------------------------------------------------------------------------

function AudioPlayer({
  recordingId,
  phone,
  onClose,
}: {
  recordingId: string;
  phone: string;
  onClose: () => void;
}) {
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
          setError('Не удалось воспроизвести');
          setLoading(false);
        });
        audio.load();
      } catch {
        if (!cancelled) {
          setError('Ошибка загрузки');
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
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    const a = audioRef.current;
    if (!bar || !a || !duration) return;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = pct * duration;
    setCurrent(a.currentTime);
  }, [duration]);

  const fmtTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-primary-50 border border-primary-100 rounded-xl p-3 mx-4 mb-3 animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={loading || !!error}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm hover:bg-primary-600 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0">
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : (
            <>
              <div
                ref={progressRef}
                className="relative h-1.5 bg-primary-200 rounded-full cursor-pointer"
                onClick={seek}
                onTouchStart={seek}
                onTouchMove={seek}
              >
                <div className="absolute left-0 top-0 h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-primary-600">{fmtTime(currentTime)}</span>
                <span className="text-[10px] text-primary-400">{fmtTime(duration)}</span>
              </div>
            </>
          )}
        </div>

        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-primary-100 text-primary-400 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call row
// ---------------------------------------------------------------------------

function CallRow({ call, canListen, activeRecording, onPlayRecording }: {
  call: Call;
  canListen: boolean;
  activeRecording: string | null;
  onPlayRecording: (id: string | null) => void;
}) {
  const isMissed = call.direction === 'incoming' && (call.status === 'missed' || call.duration === 0);
  const isIncoming = call.direction === 'incoming';
  const displayPhone = isIncoming ? call.from : call.to;
  const callTime = call.date ? new Date(call.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  const isPlaying = activeRecording === call.recordingUrl;

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors">
        {/* Left: direction indicator */}
        <div className={`flex h-9 w-9 items-center justify-center rounded-full flex-shrink-0 ${
          isMissed ? 'bg-red-50' : isIncoming ? 'bg-green-50' : 'bg-blue-50'
        }`}>
          {isMissed ? (
            <PhoneMissed className="h-4 w-4 text-red-500" />
          ) : isIncoming ? (
            <ArrowDownLeft className="h-4 w-4 text-green-600" />
          ) : (
            <ArrowUpRight className="h-4 w-4 text-blue-600" />
          )}
        </div>

        {/* Center: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${isMissed ? 'text-red-600' : 'text-gray-900'}`}>
              {formatPhone(displayPhone)}
            </p>
          </div>

          {call.client ? (
            <Link
              to={`/clients/${call.client.id}`}
              className="text-xs text-primary-600 hover:underline truncate block mt-0.5"
            >
              {call.client.fullName}
              {call.client.cars?.[0] && ` \u2022 ${call.client.cars[0].makeModel || call.client.cars[0].plateNumber}`}
            </Link>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">Неизвестный номер</p>
          )}
        </div>

        {/* Right: time + duration + play */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs text-gray-500">{callTime}</p>
            {call.duration > 0 && (
              <p className="text-[10px] text-gray-400">{formatDuration(call.duration)}</p>
            )}
            {isMissed && (
              <p className="text-[10px] font-medium text-red-500">Пропущен</p>
            )}
          </div>

          {canListen && call.recordingUrl && (
            <button
              type="button"
              onClick={() => onPlayRecording(isPlaying ? null : call.recordingUrl)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                isPlaying
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-primary-50 hover:text-primary-600'
              }`}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Inline audio player */}
      {isPlaying && call.recordingUrl && (
        <AudioPlayer
          recordingId={call.recordingUrl}
          phone={displayPhone}
          onClose={() => onPlayRecording(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const filterTabs: { key: FilterTab; label: string; icon: typeof Phone }[] = [
  { key: 'all', label: 'Все', icon: Phone },
  { key: 'incoming', label: 'Вх.', icon: PhoneIncoming },
  { key: 'outgoing', label: 'Исх.', icon: PhoneOutgoing },
  { key: 'missed', label: 'Пропущ.', icon: PhoneMissed },
];

export default function CallsPage() {
  const { hasPermission, isRole } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [activeRecording, setActiveRecording] = useState<string | null>(null);

  const canView = hasPermission('calls_view' as any) || isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);
  const canListen = hasPermission('calls_listen' as any) || isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  const dateLabel = useMemo(() => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(today, 1), 'yyyy-MM-dd');
    if (dateStr === todayStr) return 'Сегодня';
    if (dateStr === yesterdayStr) return 'Вчера';
    return format(selectedDate, 'd MMM, EEEEEE', { locale: ru });
  }, [dateStr, selectedDate]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['calls', dateStr],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: dateStr });
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: canView,
  });

  const calls: Call[] = data?.calls ?? [];
  const summary: CallsSummary | undefined = data?.summary;

  const filteredCalls = useMemo(() => {
    switch (activeTab) {
      case 'incoming':
        return calls.filter(c => c.direction === 'incoming' && c.status === 'answered');
      case 'outgoing':
        return calls.filter(c => c.direction === 'outgoing');
      case 'missed':
        return calls.filter(c => c.direction === 'incoming' && (c.status === 'missed' || c.duration === 0));
      default:
        return calls;
    }
  }, [calls, activeTab]);

  const goToPrevDay = () => { setSelectedDate(d => subDays(d, 1)); setActiveRecording(null); };
  const goToNextDay = () => {
    const tomorrow = addDays(selectedDate, 1);
    if (tomorrow <= new Date()) { setSelectedDate(tomorrow); setActiveRecording(null); }
  };
  const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Phone className="h-12 w-12 text-gray-200 mb-4" />
        <p className="text-lg font-semibold text-gray-900">Доступ ограничен</p>
        <p className="text-sm text-gray-500 mt-1">У вас нет прав для просмотра звонков</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + Date nav */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Звонки</h1>
          <p className="text-xs text-gray-400">История и записи</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={goToPrevDay} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[80px] text-center">{dateLabel}</span>
          <button type="button" onClick={goToNextDay} disabled={isToday} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-20">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex gap-2">
        {[
          { label: 'Вх.', value: summary?.incoming ?? 0, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Исх.', value: summary?.outgoing ?? 0, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Пропущ.', value: summary?.missed ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Без ответа', value: summary?.notCalledBack ?? 0, color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map(s => (
          <div key={s.label} className={`flex-1 ${s.bg} rounded-xl py-2.5 px-2 text-center`}>
            <p className={`text-lg font-bold ${s.color}`}>{isLoading ? '-' : s.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Not called back warning */}
      {summary && summary.notCalledBack > 0 && (
        <div className="flex items-center gap-2.5 bg-orange-50 border border-orange-200 rounded-xl px-3.5 py-2.5">
          <PhoneForwarded className="h-4 w-4 text-orange-500 flex-shrink-0" />
          <p className="text-xs text-orange-700 font-medium">
            {summary.notCalledBack} {summary.notCalledBack === 1 ? 'пропущенный без перезвона' : 'пропущенных без перезвона'}
          </p>
        </div>
      )}

      {/* Filter tabs + Call list */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {filterTabs.map(tab => {
            const count = tab.key === 'all' ? summary?.total
              : tab.key === 'incoming' ? summary?.incoming
              : tab.key === 'outgoing' ? summary?.outgoing
              : summary?.missed;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => { setActiveTab(tab.key); setActiveRecording(null); }}
                className={`flex-1 py-2.5 text-center transition-all relative ${
                  active ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className="text-xs font-semibold">
                  {tab.label}{count !== undefined ? ` ${count}` : ''}
                </span>
                {active && (
                  <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Call rows */}
        {isLoading ? (
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-gray-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-32 rounded bg-gray-100" />
                  <div className="h-3 w-20 rounded bg-gray-100" />
                </div>
                <div className="h-3 w-10 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center py-10">
            <AlertCircle className="h-8 w-8 text-red-300 mb-2" />
            <p className="text-sm text-red-500">Не удалось загрузить звонки</p>
            <p className="text-xs text-gray-400 mt-1">Проверьте настройки МоиЗвонки</p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Phone className="h-8 w-8 text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">
              {activeTab === 'missed' ? 'Пропущенных нет' : 'Нет звонков'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredCalls.map((call, idx) => (
              <CallRow
                key={`${call.id}-${idx}`}
                call={call}
                canListen={canListen}
                activeRecording={activeRecording}
                onPlayRecording={setActiveRecording}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
