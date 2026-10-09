import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import HubTabs from '../components/HubTabs';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import PublicBookingRequestsScreen from './PublicBookingRequestsScreen';
import PublicBookingSettingsScreen from './PublicBookingSettingsScreen';
import { publicBookingsTabs, type PublicBookingsTab } from './bookings/bookingHubTabs';

export default function PublicBookingsHubScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const canReview = hasPermission('bookings_access');
  const tabs = useMemo(() => publicBookingsTabs(canManage, canReview), [canManage, canReview]);
  const [activeTab, setActiveTab] = useState<PublicBookingsTab>(canManage ? 'settings' : 'requests');

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab) && tabs[0]) setActiveTab(tabs[0].key);
  }, [activeTab, tabs]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Онлайн-запись" onBack={() => navigation.goBack()} />
      {tabs.length > 1 && <HubTabs options={tabs} value={activeTab} onChange={setActiveTab} />}
      <View style={styles.content}>
        {activeTab === 'settings' && canManage ? (
          <PublicBookingSettingsScreen embedded />
        ) : activeTab === 'requests' && canReview ? (
          <PublicBookingRequestsScreen embedded />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
