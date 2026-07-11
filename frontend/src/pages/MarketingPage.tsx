import { useState } from 'react';
import { BarChart3, Gift, Megaphone, Plug, Send, Settings, Star, type LucideIcon } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import { UserRole } from '../types';
import MarketingReportsView from '../components/marketing/MarketingReportsView';
import ReputationView from '../components/marketing/ReputationView';
import IntegrationsView from '../components/marketing/IntegrationsView';
import MarketingSettingsView, { type SettingsSection } from '../components/marketing/MarketingSettingsView';
import BroadcastsView from '../components/marketing/BroadcastsView';
import LoyaltyView from '../components/marketing/LoyaltyView';

type Tab = 'reports' | 'reputation' | 'integrations' | 'settings' | 'broadcasts' | 'loyalty';

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'reports', label: 'Отчёты', icon: BarChart3 },
  { key: 'reputation', label: 'Отзывы', icon: Star },
  { key: 'integrations', label: 'Интеграции', icon: Plug },
  { key: 'settings', label: 'Настройки', icon: Settings },
  { key: 'broadcasts', label: 'Рассылки', icon: Send },
  { key: 'loyalty', label: 'Лояльность', icon: Gift },
];

export default function MarketingPage() {
  const { isRole } = useAuth();
  const isMaster = isRole(UserRole.MASTER);

  const [activeTab, setActiveTab] = useState<Tab>('reports');
  const [settingsFocus, setSettingsFocus] = useState<SettingsSection | null>(null);

  // Deep-link into a specific settings sub-section (from Отзывы / Рассылки).
  const goToSettings = (section?: SettingsSection) => {
    setSettingsFocus(section ?? null);
    setActiveTab('settings');
  };

  // Masters get the restricted leaderboard only — no page chrome, no tabs.
  if (isMaster) {
    return (
      <div className="mx-auto max-w-3xl">
        <ReputationView isMaster onGoToSettings={() => undefined} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Маркетинг" icon={Megaphone} subtitle="Отзывы, интеграции, рассылки и лояльность" />

      {/* Tab strip — scrollable, so all six fit on mobile */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                if (t.key !== 'settings') setSettingsFocus(null);
              }}
              className={`press-soft flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                active ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'reports' && <MarketingReportsView />}
      {activeTab === 'reputation' && <ReputationView isMaster={false} onGoToSettings={() => goToSettings('review')} />}
      {activeTab === 'integrations' && <IntegrationsView />}
      {activeTab === 'settings' && <MarketingSettingsView focus={settingsFocus} />}
      {activeTab === 'broadcasts' && <BroadcastsView onGoToSettings={goToSettings} />}
      {activeTab === 'loyalty' && <LoyaltyView />}
    </div>
  );
}
