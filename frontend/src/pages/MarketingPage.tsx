import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Gift, History, Megaphone, Plug, Send, Settings, Star, type LucideIcon } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { Card } from '../ui/Card';
import { TabPanel, Tabs } from '../ui/Tabs';
import { UserRole } from '../types';
import MarketingReportsView from '../components/marketing/MarketingReportsView';
import ReputationView from '../components/marketing/ReputationView';
import IntegrationsView from '../components/marketing/IntegrationsView';
import MarketingSettingsView, { type SettingsSection } from '../components/marketing/MarketingSettingsView';
import BroadcastsView from '../components/marketing/BroadcastsView';
import JournalView from '../components/marketing/JournalView';
import LoyaltyView from '../components/marketing/LoyaltyView';

type Tab = 'reports' | 'reputation' | 'integrations' | 'settings' | 'broadcasts' | 'journal' | 'loyalty';

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'reports', label: 'Отчёты', icon: BarChart3 },
  { key: 'reputation', label: 'Отзывы', icon: Star },
  { key: 'broadcasts', label: 'Рассылки', icon: Send },
  // «Журнал» — раздел доверия: лента каждого сообщения клиентам (sent_messages)
  // с видимыми анти-спам-гарантиями. Сразу после «Рассылок» — на виду.
  { key: 'journal', label: 'Журнал', icon: History },
  { key: 'integrations', label: 'Интеграции', icon: Plug },
  { key: 'settings', label: 'Настройки', icon: Settings },
  { key: 'loyalty', label: 'Лояльность', icon: Gift },
];
const TAB_KEYS = TABS.map((t) => t.key);

export default function MarketingPage() {
  const { isRole, hasPermission } = useAuth();
  const isMaster = isRole(UserRole.MASTER);
  // Волна «права как в Битрикс24»: ВСЕ чтения /marketing/* на сервере гейтятся
  // marketing_access — без права страница рисовала бы только 403-ошибки.
  const canAccess = hasPermission('marketing_access');

  // Вкладка — в URL (?tab=broadcasts): F5 и ссылка коллеге открывают тот же раздел.
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') as Tab | null;
  const activeTab: Tab = rawTab && TAB_KEYS.includes(rawTab) ? rawTab : 'reports';
  const [settingsFocus, setSettingsFocus] = useState<SettingsSection | null>(null);

  const setActiveTab = (tab: Tab) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (tab === 'reports') p.delete('tab');
        else p.set('tab', tab);
        return p;
      },
      { replace: true },
    );
  };

  // Deep-link into a specific settings sub-section (from Отзывы / Рассылки).
  const goToSettings = (section?: SettingsSection) => {
    setSettingsFocus(section ?? null);
    setActiveTab('settings');
  };

  if (!canAccess) {
    return (
      <div className="space-y-5">
        <PageHeader title="Маркетинг" icon={Megaphone} />
        <Card>
          <EmptyState icon={Megaphone} title="Нет доступа" description="У вас нет права на раздел «Маркетинг»" />
        </Card>
      </div>
    );
  }

  // Masters get the restricted leaderboard only — no page chrome, no tabs.
  if (isMaster) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ReputationView isMaster onGoToSettings={() => undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Маркетинг" icon={Megaphone} subtitle="Отзывы, рассылки, интеграции и лояльность" />

      <Tabs
        aria-label="Разделы маркетинга"
        idPrefix="marketing"
        items={TABS}
        value={activeTab}
        onChange={(t) => {
          setActiveTab(t);
          if (t !== 'settings') setSettingsFocus(null);
        }}
      />

      <TabPanel idPrefix="marketing" tabKey="reports" active={activeTab === 'reports'}>
        <MarketingReportsView />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="reputation" active={activeTab === 'reputation'}>
        <ReputationView isMaster={false} onGoToSettings={() => goToSettings('review')} />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="integrations" active={activeTab === 'integrations'}>
        <IntegrationsView />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="settings" active={activeTab === 'settings'}>
        <MarketingSettingsView focus={settingsFocus} />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="broadcasts" active={activeTab === 'broadcasts'}>
        <BroadcastsView onGoToSettings={goToSettings} />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="journal" active={activeTab === 'journal'}>
        <JournalView />
      </TabPanel>
      <TabPanel idPrefix="marketing" tabKey="loyalty" active={activeTab === 'loyalty'}>
        <LoyaltyView />
      </TabPanel>
    </div>
  );
}
