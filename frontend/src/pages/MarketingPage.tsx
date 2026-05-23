import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Star, AlertTriangle, Bell, Settings, Link2, MessageSquare,
  Plus, Trash2, Save, ExternalLink, TrendingUp, Users,
  Send, Eye, ThumbsUp, ThumbsDown, Loader2, X, ChevronLeft, ChevronRight, ChevronDown,
  Trophy, Medal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { marketingApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import type {
  MarketingDashboard, ReviewResponse, ReviewAlert,
  MessagingIntegration, ReviewPlatformLink, ReviewSettings,
} from '../types';

type Tab = 'dashboard' | 'reviews' | 'integrations' | 'settings';

const tabs: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: 'dashboard', label: 'Обзор', icon: BarChart3 },
  { key: 'reviews', label: 'Отзывы', icon: Star },
  { key: 'integrations', label: 'Каналы', icon: MessageSquare },
  { key: 'settings', label: 'Настройки', icon: Settings },
];

// ─── Stars Component ────────────────────────────────────────────────
function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${cls} ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
      ))}
    </div>
  );
}

// ─── Dashboard Tab ──────────────────────────────────────────────────
function DashboardTab({ data, alerts, onAlertRead }: { data: MarketingDashboard | null; alerts: ReviewAlert[]; onAlertRead: (id: string) => void }) {
  if (!data) return (
    <div className="text-center py-12">
      <BarChart3 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm text-gray-500">Нет данных</p>
      <p className="text-xs text-gray-400 mt-1">Данные появятся после получения первых отзывов</p>
    </div>
  );

  const statCards = [
    { label: 'Всего отзывов', value: data.totalReviews, icon: Star, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Средний балл', value: data.avgRating.toFixed(1), icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Отправлено', value: data.tokensSent, icon: Send, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Отвечено', value: `${data.responseRate}%`, icon: Eye, color: 'text-violet-600', bg: 'bg-violet-50' },
  ];

  const unreadAlerts = alerts.filter(a => !a.isRead);

  return (
    <div className="space-y-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg}`}>
                  <Icon className={`h-4 w-4 ${s.color}`} />
                </div>
              </div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Воронка отзывов</h3>
        <div className="space-y-2">
          {[
            { label: 'Отправлено ссылок', value: data.tokensSent, pct: 100 },
            { label: 'Получено ответов', value: data.tokensResponded, pct: data.responseRate },
            { label: 'Положительных (4-5)', value: data.positiveReviews, pct: data.totalReviews > 0 ? Math.round(data.positiveReviews / data.totalReviews * 100) : 0 },
            { label: 'Перешли на площадку', value: data.publicRedirects, pct: data.conversionRate },
          ].map(f => (
            <div key={f.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">{f.label}</span>
                <span className="font-medium text-gray-900">{f.value} ({f.pct}%)</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(f.pct, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Employee ratings */}
      {data.employeeRatings.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Рейтинг мастеров</h3>
          </div>
          <div className="space-y-3">
            {data.employeeRatings.map(e => (
              <div key={e.employeeId} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{e.employeeName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Stars rating={Math.round(e.avgRating)} />
                    <span className="text-xs text-gray-500">{e.avgRating}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-900">{e.reviewCount}</p>
                  <p className="text-xs text-gray-500">отзывов</p>
                </div>
                {e.negativeRate > 20 && (
                  <div className="flex-shrink-0">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {unreadAlerts.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-gray-900">Уведомления ({unreadAlerts.length})</h3>
          </div>
          <div className="space-y-2">
            {unreadAlerts.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-start gap-3 p-3 bg-red-50 rounded-xl">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {a.alertType === 'consecutive_negative'
                      ? `${a.employeeName}: 3 негативных подряд`
                      : `Риск ухода: ${a.clientName}`
                    }
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(a.createdAt).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                <button onClick={() => onAlertRead(a.id)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reviews Tab ────────────────────────────────────────────────────
function ReviewsTab({ reviews, loading, month, onMonthChange }: {
  reviews: ReviewResponse[]; loading: boolean; month: string; onMonthChange: (m: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedMasterId, setSelectedMasterId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'positive' | 'negative'>('all');

  const filteredReviews = reviews.filter(r => {
    if (filter === 'positive') return r.rating >= 4;
    if (filter === 'negative') return r.rating <= 3;
    return true;
  });

  const totalReviews = reviews.length;
  const avgRating = totalReviews > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / totalReviews).toFixed(1) : '0.0';
  const positiveCount = reviews.filter(r => r.rating >= 4).length;
  const negativeCount = reviews.filter(r => r.rating <= 3).length;

  const monthLabel = (() => {
    const [y, m] = month.split('-');
    const d = new Date(parseInt(y), parseInt(m) - 1);
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    const ny = d.getFullYear();
    const nm = String(d.getMonth() + 1).padStart(2, '0');
    onMonthChange(`${ny}-${nm}`);
  };

  // Compute per-employee ratings from reviews
  const employeeStats = (() => {
    const map: Record<string, { name: string; total: number; sum: number; negative: number }> = {};
    reviews.forEach(r => {
      if (!r.employeeId || !r.employeeName) return;
      if (!map[r.employeeId]) map[r.employeeId] = { name: r.employeeName, total: 0, sum: 0, negative: 0 };
      map[r.employeeId].total++;
      map[r.employeeId].sum += r.rating;
      if (r.rating <= 3) map[r.employeeId].negative++;
    });
    return Object.entries(map)
      .map(([id, s]) => ({ id, name: s.name, count: s.total, avg: s.sum / s.total, negative: s.negative }))
      .sort((a, b) => b.avg - a.avg);
  })();

  return (
    <div className="space-y-4">
      {/* Month picker */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2">
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold text-gray-900 capitalize">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Summary stats */}
      {reviews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{totalReviews}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Всего</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-amber-500">{avgRating}<span className="text-sm">★</span></p>
            <p className="text-[10px] text-gray-400 mt-0.5">Средний</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{Math.round((positiveCount / totalReviews) * 100)}%</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Позитивных</p>
          </div>
        </div>
      )}

      {/* Filter chips */}
      {reviews.length > 0 && (
        <div className="flex gap-2">
          <button onClick={() => setFilter('all')} className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === 'all' ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'bg-gray-50 text-gray-500'}`}>
            Все ({totalReviews})
          </button>
          <button onClick={() => setFilter('positive')} className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === 'positive' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-500'}`}>
            👍 ({positiveCount})
          </button>
          <button onClick={() => setFilter('negative')} className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === 'negative' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-50 text-gray-500'}`}>
            👎 ({negativeCount})
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12">
          <Star className="h-10 w-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Отзывов за этот месяц нет</p>
        </div>
      ) : (
        <>
          {/* Employee ratings — clickable */}
          {employeeStats.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-900">Рейтинг мастеров</h3>
              </div>
              <div className="space-y-2">
                {employeeStats.map((e, idx) => {
                  const avgRounded = Math.round(e.avg * 10) / 10;
                  const isGood = avgRounded >= 4;
                  const isSelected = selectedMasterId === e.id;
                  const masterReviews = reviews.filter(r => r.employeeId === e.id);
                  return (
                    <div key={e.id}>
                      <button
                        onClick={() => setSelectedMasterId(isSelected ? null : e.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                          isSelected ? 'bg-primary-50 border border-primary-200' : isGood ? 'bg-green-50 hover:bg-green-100' : 'bg-red-50 hover:bg-red-100'
                        }`}
                      >
                        <div className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold text-white ${
                          idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-amber-700' : 'bg-gray-300'
                        }`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{e.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Stars rating={Math.round(e.avg)} />
                            <span className={`text-xs font-bold ${isGood ? 'text-green-600' : 'text-red-600'}`}>{avgRounded}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-gray-900">{e.count}</p>
                          <p className="text-[10px] text-gray-400">отзыв{e.count === 1 ? '' : e.count < 5 ? 'а' : 'ов'}</p>
                        </div>
                        {e.negative > 0 && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                        <ChevronDown className={`h-4 w-4 text-gray-300 flex-shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Expanded: master's review history */}
                      {isSelected && (
                        <div className="mt-2 ml-3 border-l-2 border-primary-200 pl-3 space-y-2">
                          <div className="flex items-center gap-4 text-xs text-gray-500 py-1">
                            <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3 text-green-500" />{masterReviews.filter(r => r.rating >= 4).length} положит.</span>
                            <span className="flex items-center gap-1"><ThumbsDown className="h-3 w-3 text-red-500" />{e.negative} негатив.</span>
                          </div>
                          {masterReviews.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2">Нет отзывов за этот период</p>
                          ) : (
                            masterReviews.map(r => {
                              const good = r.rating >= 4;
                              return (
                                <div key={r.id} className={`p-3 rounded-lg ${good ? 'bg-green-50' : 'bg-red-50'}`}>
                                  <div className="flex items-center gap-2">
                                    <div className={`flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold text-white ${good ? 'bg-green-500' : 'bg-red-500'}`}>
                                      {r.rating}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      {r.clientId ? (
                                        <a href={`/clients/${r.clientId}`} className="text-sm font-medium text-primary-600 hover:underline truncate block">{r.clientName || 'Клиент'}</a>
                                      ) : (
                                        <p className="text-sm font-medium text-gray-900 truncate">{r.clientName || 'Клиент'}</p>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-gray-400 flex-shrink-0">
                                      {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                                    </span>
                                  </div>
                                  {(r.carMakeModel || r.carPlate) && (
                                    <p className="text-xs text-gray-500 mt-1 ml-8">
                                      {r.carMakeModel}{r.carPlate && ` · ${r.carPlate}`}
                                    </p>
                                  )}
                                  {r.comment && (
                                    <p className={`text-xs mt-1.5 ml-8 ${good ? 'text-green-700' : 'text-red-700'}`}>{r.comment}</p>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* All reviews journal */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Все отзывы</h3>
            <div className="space-y-1">
              {filteredReviews.map(r => {
                const isGood = r.rating >= 4;
                const isExpanded = expandedId === r.id;
                return (
                  <div key={r.id}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        isGood ? 'hover:bg-green-50' : 'hover:bg-red-50'
                      } ${isExpanded ? (isGood ? 'bg-green-50' : 'bg-red-50') : ''}`}
                    >
                      <div className={`flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold text-white ${
                        isGood ? 'bg-green-500' : 'bg-red-500'
                      }`}>
                        {r.rating}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.clientName || 'Клиент'}</p>
                        <p className="text-xs text-gray-400">
                          {r.employeeName && `${r.employeeName} · `}
                          {r.carMakeModel && `${r.carMakeModel} · `}
                          {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      {r.clientId && (
                        <a href={`/clients/${r.clientId}`} onClick={e => e.stopPropagation()} className="text-xs text-primary-500 hover:underline flex-shrink-0">
                          Профиль
                        </a>
                      )}
                      {r.comment && (
                        <ChevronDown className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      )}
                    </button>
                    {isExpanded && r.comment && (
                      <div className={`mx-3 mb-1 px-3 py-2 rounded-lg text-sm ${isGood ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                        {r.comment}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Integrations Tab ───────────────────────────────────────────────
function IntegrationsTab({
  integrations, platformLinks, onSaveIntegration, onRemoveIntegration,
  onSavePlatformLink, onRemovePlatformLink,
}: {
  integrations: MessagingIntegration[];
  platformLinks: ReviewPlatformLink[];
  onSaveIntegration: (d: any) => void;
  onRemoveIntegration: (id: string) => void;
  onSavePlatformLink: (d: any) => void;
  onRemovePlatformLink: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ providerType: 'moizvonki', apiKey: '', senderName: '', senderPhone: '', webhookUrl: '' });
  const [linkForm, setLinkForm] = useState({ platform: 'google', url: '' });
  const [showLinkForm, setShowLinkForm] = useState(false);

  const providerLabels: Record<string, string> = { moizvonki: 'Мои Звонки', smsru: 'SMS.RU', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
  const platformLabels: Record<string, string> = { google: 'Google Maps', yandex: 'Яндекс', '2gis': '2ГИС' };
  const platformColors: Record<string, string> = { google: 'bg-blue-50 text-blue-600', yandex: 'bg-red-50 text-red-600', '2gis': 'bg-green-50 text-green-600' };

  return (
    <div className="space-y-5">
      {/* Messaging providers */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Провайдеры рассылок</h3>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="text-violet-600 hover:text-violet-700">
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {showForm && (
          <div className="space-y-3 mb-4 p-3 bg-gray-50 rounded-xl">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Тип</label>
              <select value={form.providerType} onChange={e => setForm({ ...form, providerType: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="moizvonki">Мои Звонки</option>
                <option value="smsru">SMS.RU</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS (другой)</option>
                <option value="email">Email</option>
              </select>
            </div>

            {/* Мои Звонки fields */}
            {form.providerType === 'moizvonki' && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Домен (поддомен в moizvonki.ru)</label>
                  <div className="flex items-center gap-0">
                    <input value={form.webhookUrl} onChange={e => setForm({ ...form, webhookUrl: e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, '') })}
                      className="flex-1 rounded-l-lg border border-r-0 border-gray-200 px-3 py-2 text-sm" placeholder="mycompany" />
                    <span className="bg-gray-100 border border-gray-200 rounded-r-lg px-3 py-2 text-xs text-gray-500">.moizvonki.ru</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Например: если ваш адрес mycompany.moizvonki.ru — введите mycompany</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Email (логин в Мои Звонки)</label>
                  <input type="email" value={form.senderName} onChange={e => setForm({ ...form, senderName: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="user@mail.ru" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Ключ API</label>
                  <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Скопируйте из Настройки → Интеграция" />
                  <p className="text-xs text-gray-400 mt-1">Личный кабинет → Настройки → Интеграция → Ключ API</p>
                </div>
              </>
            )}

            {/* SMS.RU fields */}
            {form.providerType === 'smsru' && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">API ID (из кабинета sms.ru)</label>
                  <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" />
                  <p className="text-xs text-gray-400 mt-1">Скопируйте API ID из sms.ru → Настройки</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Имя отправителя (опц.)</label>
                  <input value={form.senderName} onChange={e => setForm({ ...form, senderName: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Одобренное в sms.ru" />
                </div>
              </>
            )}

            {/* Generic SMS / WhatsApp / Email fields */}
            {!['moizvonki', 'smsru'].includes(form.providerType) && (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">API ключ</label>
                  <input value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Ваш API ключ" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Имя отправителя</label>
                    <input value={form.senderName} onChange={e => setForm({ ...form, senderName: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Телефон</label>
                    <input value={form.senderPhone} onChange={e => setForm({ ...form, senderPhone: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                </div>
              </>
            )}

            <button onClick={() => { onSaveIntegration(form); setShowForm(false); setForm({ providerType: 'moizvonki', apiKey: '', senderName: '', senderPhone: '', webhookUrl: '' }); }}
              className="w-full bg-violet-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-violet-700 transition-colors">
              Сохранить
            </button>
          </div>
        )}

        {integrations.length === 0 && !showForm ? (
          <p className="text-sm text-gray-400 text-center py-4">Нет настроенных провайдеров</p>
        ) : (
          <div className="space-y-2">
            {integrations.map(i => (
              <div key={i.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${i.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-sm font-medium text-gray-900">{providerLabels[i.providerType] || i.providerType}</span>
                  {i.senderName && <span className="text-xs text-gray-500">({i.senderName})</span>}
                </div>
                <button onClick={() => onRemoveIntegration(i.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Platform links */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Ссылки на площадки</h3>
          </div>
          <button onClick={() => setShowLinkForm(!showLinkForm)} className="text-violet-600 hover:text-violet-700">
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {showLinkForm && (
          <div className="space-y-3 mb-4 p-3 bg-gray-50 rounded-xl">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Площадка</label>
              <select value={linkForm.platform} onChange={e => setLinkForm({ ...linkForm, platform: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="google">Google Maps</option>
                <option value="yandex">Яндекс</option>
                <option value="2gis">2ГИС</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Ссылка</label>
              <input value={linkForm.url} onChange={e => setLinkForm({ ...linkForm, url: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="https://..." />
            </div>
            <button onClick={() => { onSavePlatformLink(linkForm); setShowLinkForm(false); setLinkForm({ platform: 'google', url: '' }); }}
              className="w-full bg-violet-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-violet-700 transition-colors">
              Сохранить
            </button>
          </div>
        )}

        {platformLinks.length === 0 && !showLinkForm ? (
          <p className="text-sm text-gray-400 text-center py-4">Добавьте ссылки на площадки для отзывов</p>
        ) : (
          <div className="space-y-2">
            {platformLinks.map(l => (
              <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${platformColors[l.platform] || 'bg-gray-100 text-gray-600'}`}>
                    {platformLabels[l.platform] || l.platform}
                  </span>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline truncate max-w-[140px]">
                    {l.url}
                  </a>
                </div>
                <button onClick={() => onRemovePlatformLink(l.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Tab ───────────────────────────────────────────────────
function SettingsTab({ settings, onSave }: { settings: ReviewSettings | null; onSave: (s: Partial<ReviewSettings>) => void }) {
  const [form, setForm] = useState<Partial<ReviewSettings>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);

  const update = (patch: Partial<ReviewSettings>) => {
    setForm(prev => ({ ...prev, ...patch }));
    setDirty(true);
  };

  if (!settings) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Параметры отправки</h3>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Время отправки</label>
          <input type="time" value={form.sendTime || '20:00'} onChange={e => update({ sendTime: e.target.value })}
            className="w-36 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Задержка (часов)</label>
          <input type="number" min={0} max={48} value={form.feedbackDelayHours ?? 2}
            onChange={e => update({ feedbackDelayHours: parseInt(e.target.value) || 0 })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <p className="text-xs text-gray-400 mt-1">Через сколько часов отправлять, если время уже прошло</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Автоотправка</p>
            <p className="text-xs text-gray-500">Отправлять запрос отзыва автоматически</p>
          </div>
          <button onClick={() => update({ autoSendEnabled: !form.autoSendEnabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.autoSendEnabled ? 'bg-violet-600' : 'bg-gray-200'}`}>
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${form.autoSendEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Шаблон сообщения</h3>
        <textarea
          rows={4}
          value={form.messageTemplate || ''}
          onChange={e => update({ messageTemplate: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {['{clientName}', '{tenantName}', '{reviewLink}', '{motivation}'].map(tag => (
            <span key={tag} className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full font-mono">{tag}</span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Подарок за отзыв</h3>
        <p className="text-xs text-gray-500">
          Эта фраза показывается клиенту на странице оценки и подставляется вместо <code>{'{motivation}'}</code> в шаблоне.
        </p>
        <textarea
          rows={3}
          value={form.motivationMessage || ''}
          onChange={e => update({ motivationMessage: e.target.value })}
          placeholder="Например: Замена воздушного фильтра в подарок за честный отзыв"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none"
        />
      </div>

      {dirty && (
        <button onClick={() => { onSave(form); setDirty(false); }}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-violet-700 transition-colors">
          <Save className="h-4 w-4" />
          Сохранить настройки
        </button>
      )}
    </div>
  );
}

// ─── Master Rating View (mobile-first, beautiful UX) ────────────────
function MasterRatingView() {
  const [reviews, setReviews] = useState<ReviewResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthLabel = (() => {
    const [y, m] = month.split('-');
    const d = new Date(parseInt(y), parseInt(m) - 1);
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const onMonthChange = useCallback(async (m: string) => {
    setMonth(m);
    setLoading(true);
    try {
      const res = await marketingApi.getReviews({ month: m });
      setReviews(res.data);
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { onMonthChange(month); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Build ranking from reviews
  const ranking = (() => {
    const map: Record<string, { name: string; total: number; sum: number }> = {};
    reviews.forEach(r => {
      if (!r.employeeId || !r.employeeName) return;
      if (!map[r.employeeId]) map[r.employeeId] = { name: r.employeeName, total: 0, sum: 0 };
      map[r.employeeId].total++;
      map[r.employeeId].sum += r.rating;
    });
    return Object.entries(map)
      .map(([id, s]) => ({ id, name: s.name, count: s.total, avg: Math.round(s.sum / s.total * 10) / 10 }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  })();

  const placeColors = [
    'from-amber-400 to-yellow-500',   // 1st — gold
    'from-gray-300 to-gray-400',      // 2nd — silver
    'from-amber-600 to-orange-500',   // 3rd — bronze
  ];

  const placeBg = [
    'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200',
    'bg-gradient-to-br from-gray-50 to-slate-50 border-gray-200',
    'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200',
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-1">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h1 className="text-xl font-bold text-gray-900">Рейтинг мастеров</h1>
        </div>
        <p className="text-sm text-gray-500">Оценки клиентов по месяцам</p>
      </div>

      {/* Month picker */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 active:scale-95 transition-all">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-2 shadow-sm min-w-[160px] text-center">
          <span className="text-sm font-semibold text-gray-900 capitalize">{monthLabel}</span>
        </div>
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 active:scale-95 transition-all">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-gray-300" /></div>
      ) : ranking.length === 0 ? (
        <div className="text-center py-16">
          <Star className="h-12 w-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">Нет отзывов за этот месяц</p>
          <p className="text-xs text-gray-400 mt-1">Рейтинг появится после получения отзывов от клиентов</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ranking.map((m, idx) => {
            const place = idx + 1;
            const isTop3 = place <= 3;

            return (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 transition-all ${
                  isTop3 ? placeBg[idx] : 'bg-white border-gray-100'
                } ${place === 1 ? 'shadow-md' : 'shadow-sm'}`}
              >
                <div className="flex items-center gap-3">
                  {/* Place badge */}
                  {isTop3 ? (
                    <div className={`flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br ${placeColors[idx]} text-white font-bold text-sm shadow-sm flex-shrink-0`}>
                      {place === 1 ? <Trophy className="h-5 w-5" /> : place === 2 ? <Medal className="h-5 w-5" /> : place}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gray-100 text-gray-500 font-bold text-sm flex-shrink-0">
                      {place}
                    </div>
                  )}

                  {/* Name & stars */}
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${place === 1 ? 'text-base text-gray-900' : 'text-sm text-gray-800'}`}>
                      {m.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Stars rating={Math.round(m.avg)} size={place === 1 ? 'md' : 'sm'} />
                      <span className={`text-xs font-bold ${m.avg >= 4 ? 'text-green-600' : m.avg >= 3 ? 'text-amber-600' : 'text-red-600'}`}>
                        {m.avg.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  {/* Review count */}
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold ${place === 1 ? 'text-lg text-gray-900' : 'text-base text-gray-700'}`}>{m.count}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                      отзыв{m.count === 1 ? '' : m.count < 5 ? 'а' : 'ов'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Marketing Page ────────────────────────────────────────────
export default function MarketingPage() {
  const { isRole } = useAuth();
  const isMaster = isRole(UserRole.MASTER);

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<MarketingDashboard | null>(null);
  const [reviews, setReviews] = useState<ReviewResponse[]>([]);
  const [alerts, setAlerts] = useState<ReviewAlert[]>([]);
  const [integrations, setIntegrations] = useState<MessagingIntegration[]>([]);
  const [platformLinks, setPlatformLinks] = useState<ReviewPlatformLink[]>([]);
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewMonth, setReviewMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const loadDashboard = useCallback(async () => {
    try {
      const [dashRes, alertsRes] = await Promise.all([
        marketingApi.getDashboard(),
        marketingApi.getAlerts(),
      ]);
      setDashboard(dashRes.data);
      setAlerts(alertsRes.data);
    } catch { /* empty */ }
  }, []);

  const loadReviews = useCallback(async (month?: string) => {
    setReviewsLoading(true);
    try {
      const res = await marketingApi.getReviews({ month: month || reviewMonth });
      setReviews(res.data);
    } catch { /* empty */ } finally {
      setReviewsLoading(false);
    }
  }, [reviewMonth]);

  const loadIntegrations = useCallback(async () => {
    try {
      const [intRes, linkRes] = await Promise.all([
        marketingApi.getIntegrations(),
        marketingApi.getPlatformLinks(),
      ]);
      setIntegrations(intRes.data);
      setPlatformLinks(linkRes.data);
    } catch { /* empty */ }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await marketingApi.getSettings();
      setSettings(res.data);
    } catch { /* empty */ }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadDashboard(), loadSettings()]);
      setLoading(false);
    };
    init();
  }, [loadDashboard, loadSettings]);

  useEffect(() => {
    if (activeTab === 'reviews') loadReviews(reviewMonth);
    if (activeTab === 'integrations') loadIntegrations();
  }, [activeTab, reviewMonth, loadReviews, loadIntegrations]);

  const handleAlertRead = async (id: string) => {
    try {
      await marketingApi.markAlertRead(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
    } catch { toast.error('Ошибка'); }
  };

  const handleSaveIntegration = async (data: any) => {
    try {
      const res = await marketingApi.upsertIntegration(data);
      setIntegrations(res.data);
      toast.success('Провайдер сохранён');
    } catch { toast.error('Ошибка сохранения'); }
  };

  const handleRemoveIntegration = async (id: string) => {
    try {
      await marketingApi.removeIntegration(id);
      setIntegrations(prev => prev.filter(i => i.id !== id));
      toast.success('Удалено');
    } catch { toast.error('Ошибка удаления'); }
  };

  const handleSavePlatformLink = async (data: any) => {
    try {
      const res = await marketingApi.upsertPlatformLink(data);
      setPlatformLinks(res.data);
      toast.success('Ссылка сохранена');
    } catch { toast.error('Ошибка сохранения'); }
  };

  const handleRemovePlatformLink = async (id: string) => {
    try {
      await marketingApi.removePlatformLink(id);
      setPlatformLinks(prev => prev.filter(l => l.id !== id));
      toast.success('Удалено');
    } catch { toast.error('Ошибка удаления'); }
  };

  const handleSaveSettings = async (data: Partial<ReviewSettings>) => {
    try {
      const res = await marketingApi.updateSettings(data);
      setSettings(res.data);
      toast.success('Настройки сохранены');
    } catch { toast.error('Ошибка сохранения'); }
  };

  // Masters only see the rating leaderboard
  if (isMaster) return <MasterRatingView />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Репутация</h1>
        <p className="text-sm text-gray-500">Управление отзывами и обратной связью</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors
                ${isActive ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {activeTab === 'dashboard' && <DashboardTab data={dashboard} alerts={alerts} onAlertRead={handleAlertRead} />}
          {activeTab === 'reviews' && <ReviewsTab reviews={reviews} loading={reviewsLoading} month={reviewMonth} onMonthChange={setReviewMonth} />}
          {activeTab === 'integrations' && (
            <IntegrationsTab
              integrations={integrations} platformLinks={platformLinks}
              onSaveIntegration={handleSaveIntegration} onRemoveIntegration={handleRemoveIntegration}
              onSavePlatformLink={handleSavePlatformLink} onRemovePlatformLink={handleRemovePlatformLink}
            />
          )}
          {activeTab === 'settings' && <SettingsTab settings={settings} onSave={handleSaveSettings} />}
        </>
      )}
    </div>
  );
}
