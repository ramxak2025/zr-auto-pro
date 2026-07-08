import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gift,
  Send,
  Settings2,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { marketingApi } from '../../api/services';
import type { ReviewAlert, ReviewResponse, ReviewSettings } from '../../types';
import MasterLeaderboard from './MasterLeaderboard';
import { EmptyState, LoadingBlock, SectionCard, Stars, SaveButton } from './marketingKit';

// ─── Unread negative-review / churn alerts ──────────────────────────
function AlertsCard() {
  const qc = useQueryClient();
  const { data: alerts = [] } = useQuery({
    queryKey: ['marketing', 'alerts'],
    queryFn: () => marketingApi.getAlerts().then((r) => r.data),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => marketingApi.markAlertRead(id),
    onMutate: (id: string) => {
      qc.setQueryData<ReviewAlert[]>(['marketing', 'alerts'], (prev) =>
        (prev ?? []).map((a) => (a.id === id ? { ...a, isRead: true } : a)),
      );
    },
    onError: () => toast.error('Не удалось отметить'),
  });

  const unread = alerts.filter((a: ReviewAlert) => !a.isRead);
  if (unread.length === 0) return null;

  return (
    <SectionCard icon={Bell} iconClass="bg-red-50 text-red-600" title={`Требуют внимания (${unread.length})`}>
      <div className="space-y-2">
        {unread.slice(0, 6).map((a: ReviewAlert) => (
          <div key={a.id} className="flex items-start gap-3 rounded-xl bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {a.alertType === 'consecutive_negative'
                  ? `${a.employeeName ?? 'Мастер'}: 3 негативных отзыва подряд`
                  : `Риск ухода клиента: ${a.clientName ?? '—'}`}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">{new Date(a.createdAt).toLocaleDateString('ru-RU')}</p>
            </div>
            <button
              onClick={() => markRead.mutate(a.id)}
              className="press-soft text-gray-400 hover:text-gray-600"
              aria-label="Скрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ─── «Подарок за отзыв» + запрос отзыва ─────────────────────────────
function MotivationCard({ onGoToSettings }: { onGoToSettings: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['marketing', 'settings'],
    queryFn: () => marketingApi.getSettings().then((r) => r.data),
  });

  const [motivation, setMotivation] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setMotivation(settings.motivationMessage ?? '');
      setDirty(false);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: (data: Partial<ReviewSettings>) => marketingApi.updateSettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['marketing', 'settings'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <SectionCard
      icon={Gift}
      iconClass="bg-amber-50 text-amber-600"
      title="Подарок за отзыв"
      subtitle="Показывается клиенту на странице оценки и подставляется как {motivation} в запросе"
    >
      <textarea
        rows={2}
        value={motivation}
        onChange={(e) => {
          setMotivation(e.target.value);
          setDirty(true);
        }}
        placeholder="Например: Замена воздушного фильтра в подарок за честный отзыв"
        className="input resize-none"
      />

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-50 px-3.5 py-3">
        <Send className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <p className="min-w-0 flex-1 text-xs text-gray-600">
          Запрос отзыва уходит клиенту{' '}
          {settings?.autoSendEnabled ? (
            <span className="font-medium text-green-600">автоматически</span>
          ) : (
            <span className="font-medium text-gray-500">вручную (автоотправка выключена)</span>
          )}{' '}
          после закрытия заказ-наряда.
        </p>
        <button onClick={onGoToSettings} className="btn-secondary btn-sm flex-shrink-0">
          <Settings2 className="h-3.5 w-3.5" />
          Настроить
        </button>
      </div>

      {dirty && (
        <div className="mt-3">
          <SaveButton onClick={() => save.mutate({ motivationMessage: motivation })} saving={save.isPending}>
            Сохранить подарок
          </SaveButton>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Owner reputation hub ───────────────────────────────────────────
function OwnerReputation({ onGoToSettings }: { onGoToSettings: () => void }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [filter, setFilter] = useState<'all' | 'positive' | 'negative'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['marketing', 'reviews', month],
    queryFn: () => marketingApi.getReviews({ month }).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }, [month]);

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const total = reviews.length;
  const avgRating = total > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(1) : '0.0';
  const positiveCount = reviews.filter((r) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r) => r.rating <= 3).length;

  const filteredReviews = reviews.filter((r) => {
    if (filter === 'positive') return r.rating >= 4;
    if (filter === 'negative') return r.rating <= 3;
    return true;
  });

  const employeeStats = useMemo(() => {
    const map: Record<string, { name: string; total: number; sum: number; negative: number }> = {};
    reviews.forEach((r: ReviewResponse) => {
      if (!r.employeeId || !r.employeeName) return;
      if (!map[r.employeeId]) map[r.employeeId] = { name: r.employeeName, total: 0, sum: 0, negative: 0 };
      map[r.employeeId].total++;
      map[r.employeeId].sum += r.rating;
      if (r.rating <= 3) map[r.employeeId].negative++;
    });
    return Object.entries(map)
      .map(([id, s]) => ({ id, name: s.name, count: s.total, avg: s.sum / s.total, negative: s.negative }))
      .sort((a, b) => b.avg - a.avg);
  }, [reviews]);

  return (
    <div className="space-y-4">
      <AlertsCard />

      {/* Month picker */}
      <div className="card flex items-center justify-between px-3 py-2">
        <button
          onClick={() => shiftMonth(-1)}
          className="press-soft rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold capitalize text-gray-900">{monthLabel}</span>
        <button
          onClick={() => shiftMonth(1)}
          className="press-soft rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Следующий месяц"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Summary */}
      {total > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card p-3 text-center">
            <p className="text-2xl font-bold tabular-nums text-gray-900">{total}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">Всего</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-2xl font-bold tabular-nums text-amber-500">
              {avgRating}
              <span className="text-sm">★</span>
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">Средний</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-2xl font-bold tabular-nums text-green-600">
              {Math.round((positiveCount / total) * 100)}%
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">Позитивных</p>
          </div>
        </div>
      )}

      {/* Filter chips */}
      {total > 0 && (
        <div className="flex gap-2">
          {(
            [
              ['all', `Все (${total})`, 'primary'],
              ['positive', `👍 ${positiveCount}`, 'green'],
              ['negative', `👎 ${negativeCount}`, 'red'],
            ] as const
          ).map(([key, label, tone]) => {
            const active = filter === key;
            const activeCls =
              tone === 'green'
                ? 'bg-green-50 text-green-700 border-green-200'
                : tone === 'red'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-primary-50 text-primary-700 border-primary-200';
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`press-soft flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors ${
                  active ? activeCls : 'border-transparent bg-gray-50 text-gray-500'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <LoadingBlock />
      ) : total === 0 ? (
        <SectionCard icon={Star} title="Отзывы">
          <EmptyState icon={Star} title="Отзывов за этот месяц нет" hint="Выберите другой месяц или дождитесь оценок" />
        </SectionCard>
      ) : (
        <>
          {/* Leaderboard (expandable) */}
          {employeeStats.length > 0 && (
            <SectionCard icon={Trophy} iconClass="bg-amber-50 text-amber-600" title="Рейтинг мастеров">
              <div className="space-y-2">
                {employeeStats.map((e, idx) => {
                  const avgRounded = Math.round(e.avg * 10) / 10;
                  const isGood = avgRounded >= 4;
                  const isSelected = selectedMasterId === e.id;
                  const masterReviews = reviews.filter((r) => r.employeeId === e.id);
                  return (
                    <div key={e.id}>
                      <button
                        onClick={() => setSelectedMasterId(isSelected ? null : e.id)}
                        className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all ${
                          isSelected
                            ? 'border border-primary-200 bg-primary-50'
                            : isGood
                              ? 'bg-green-50 hover:bg-green-100'
                              : 'bg-red-50 hover:bg-red-100'
                        }`}
                      >
                        <div
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                            idx === 0
                              ? 'bg-amber-500'
                              : idx === 1
                                ? 'bg-gray-400'
                                : idx === 2
                                  ? 'bg-amber-700'
                                  : 'bg-gray-300'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{e.name}</p>
                          <div className="mt-0.5 flex items-center gap-2">
                            <Stars rating={Math.round(e.avg)} />
                            <span
                              className={`text-xs font-bold tabular-nums ${isGood ? 'text-green-600' : 'text-red-600'}`}
                            >
                              {avgRounded}
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-gray-900">{e.count}</p>
                          <p className="text-[10px] text-gray-400">
                            отзыв{e.count === 1 ? '' : e.count < 5 ? 'а' : 'ов'}
                          </p>
                        </div>
                        {e.negative > 0 && <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />}
                        <ChevronDown
                          className={`h-4 w-4 flex-shrink-0 text-gray-300 transition-transform ${isSelected ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {isSelected && (
                        <div className="ml-3 mt-2 space-y-2 border-l-2 border-primary-200 pl-3">
                          <div className="flex items-center gap-4 py-1 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <ThumbsUp className="h-3 w-3 text-green-500" />
                              {masterReviews.filter((r) => r.rating >= 4).length} положит.
                            </span>
                            <span className="flex items-center gap-1">
                              <ThumbsDown className="h-3 w-3 text-red-500" />
                              {e.negative} негатив.
                            </span>
                          </div>
                          {masterReviews.map((r) => {
                            const good = r.rating >= 4;
                            return (
                              <div key={r.id} className={`rounded-lg p-3 ${good ? 'bg-green-50' : 'bg-red-50'}`}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${good ? 'bg-green-500' : 'bg-red-500'}`}
                                  >
                                    {r.rating}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    {r.clientId ? (
                                      <a
                                        href={`/clients/${r.clientId}`}
                                        className="block truncate text-sm font-medium text-primary-600 hover:underline"
                                      >
                                        {r.clientName || 'Клиент'}
                                      </a>
                                    ) : (
                                      <p className="truncate text-sm font-medium text-gray-900">
                                        {r.clientName || 'Клиент'}
                                      </p>
                                    )}
                                  </div>
                                  <span className="flex-shrink-0 text-[10px] text-gray-400">
                                    {new Date(r.createdAt).toLocaleDateString('ru-RU', {
                                      day: 'numeric',
                                      month: 'short',
                                    })}
                                  </span>
                                </div>
                                {(r.carMakeModel || r.carPlate) && (
                                  <p className="ml-8 mt-1 text-xs text-gray-500">
                                    {r.carMakeModel}
                                    {r.carPlate && ` · ${r.carPlate}`}
                                  </p>
                                )}
                                {r.comment && (
                                  <p className={`ml-8 mt-1.5 text-xs ${good ? 'text-green-700' : 'text-red-700'}`}>
                                    {r.comment}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Review feed */}
          <SectionCard icon={Star} iconClass="bg-primary-50 text-primary-600" title="Все отзывы">
            {filteredReviews.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400">Нет отзывов под выбранным фильтром</p>
            ) : (
              <div className="space-y-1">
                {filteredReviews.map((r) => {
                  const isGood = r.rating >= 4;
                  const isExpanded = expandedId === r.id;
                  return (
                    <div key={r.id}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          isGood ? 'hover:bg-green-50' : 'hover:bg-red-50'
                        } ${isExpanded ? (isGood ? 'bg-green-50' : 'bg-red-50') : ''}`}
                      >
                        <div
                          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${isGood ? 'bg-green-500' : 'bg-red-500'}`}
                        >
                          {r.rating}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{r.clientName || 'Клиент'}</p>
                          <p className="text-xs text-gray-400">
                            {r.employeeName && `${r.employeeName} · `}
                            {r.carMakeModel && `${r.carMakeModel} · `}
                            {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </p>
                        </div>
                        {r.clientId && (
                          <a
                            href={`/clients/${r.clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0 text-xs text-primary-500 hover:underline"
                          >
                            Профиль
                          </a>
                        )}
                        {r.comment && (
                          <ChevronDown
                            className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        )}
                      </button>
                      {isExpanded && r.comment && (
                        <div
                          className={`mx-3 mb-1 rounded-lg px-3 py-2 text-sm ${isGood ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
                        >
                          {r.comment}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <MotivationCard onGoToSettings={onGoToSettings} />
    </div>
  );
}

export default function ReputationView({
  isMaster,
  onGoToSettings,
}: {
  isMaster: boolean;
  onGoToSettings: () => void;
}) {
  if (isMaster) return <MasterLeaderboard />;
  return <OwnerReputation onGoToSettings={onGoToSettings} />;
}
