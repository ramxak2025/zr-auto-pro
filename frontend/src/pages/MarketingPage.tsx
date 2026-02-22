import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Star, AlertTriangle, Bell, Settings, Link2, MessageSquare,
  Plus, Trash2, Save, ExternalLink, TrendingUp, Users,
  Send, Eye, ThumbsUp, ThumbsDown, Loader2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { marketingApi } from '../api/services';
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
  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

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
function ReviewsTab({ reviews, loading }: { reviews: ReviewResponse[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (reviews.length === 0) return (
    <div className="text-center py-12">
      <Star className="h-10 w-10 text-gray-200 mx-auto mb-3" />
      <p className="text-sm text-gray-500">Отзывов пока нет</p>
      <p className="text-xs text-gray-400 mt-1">Они появятся после того, как клиенты оценят обслуживание</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {reviews.map(r => (
        <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{r.clientName || 'Клиент'}</p>
              {r.employeeName && <p className="text-xs text-gray-500">Мастер: {r.employeeName}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {r.rating >= 4 ? (
                <ThumbsUp className="h-4 w-4 text-green-500" />
              ) : (
                <ThumbsDown className="h-4 w-4 text-red-500" />
              )}
              <Stars rating={r.rating} />
            </div>
          </div>
          {r.comment && (
            <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 mb-2">{r.comment}</p>
          )}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {r.redirectedTo && (
              <span className="flex items-center gap-1 text-green-600">
                <ExternalLink className="h-3 w-3" />
                {r.redirectedTo}
              </span>
            )}
          </div>
        </div>
      ))}
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
  const [form, setForm] = useState({ providerType: 'whatsapp', apiKey: '', senderName: '', senderPhone: '' });
  const [linkForm, setLinkForm] = useState({ platform: 'google', url: '' });
  const [showLinkForm, setShowLinkForm] = useState(false);

  const providerLabels: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
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
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
            </div>
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
            <button onClick={() => { onSaveIntegration(form); setShowForm(false); setForm({ providerType: 'whatsapp', apiKey: '', senderName: '', senderPhone: '' }); }}
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
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
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
          {['{clientName}', '{tenantName}', '{reviewLink}'].map(tag => (
            <span key={tag} className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full font-mono">{tag}</span>
          ))}
        </div>
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

// ─── Main Marketing Page ────────────────────────────────────────────
export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<MarketingDashboard | null>(null);
  const [reviews, setReviews] = useState<ReviewResponse[]>([]);
  const [alerts, setAlerts] = useState<ReviewAlert[]>([]);
  const [integrations, setIntegrations] = useState<MessagingIntegration[]>([]);
  const [platformLinks, setPlatformLinks] = useState<ReviewPlatformLink[]>([]);
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);

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

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await marketingApi.getReviews();
      setReviews(res.data);
    } catch { /* empty */ } finally {
      setReviewsLoading(false);
    }
  }, []);

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
    if (activeTab === 'reviews') loadReviews();
    if (activeTab === 'integrations') loadIntegrations();
  }, [activeTab, loadReviews, loadIntegrations]);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

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
      {activeTab === 'dashboard' && <DashboardTab data={dashboard} alerts={alerts} onAlertRead={handleAlertRead} />}
      {activeTab === 'reviews' && <ReviewsTab reviews={reviews} loading={reviewsLoading} />}
      {activeTab === 'integrations' && (
        <IntegrationsTab
          integrations={integrations} platformLinks={platformLinks}
          onSaveIntegration={handleSaveIntegration} onRemoveIntegration={handleRemoveIntegration}
          onSavePlatformLink={handleSavePlatformLink} onRemovePlatformLink={handleRemovePlatformLink}
        />
      )}
      {activeTab === 'settings' && <SettingsTab settings={settings} onSave={handleSaveSettings} />}
    </div>
  );
}
